import { callClaude, MODEL } from "./claude";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

export type ReportStatus = "On track" | "At risk" | "Blocked" | "No activity";

export type ReportItem = { title: string; owner_name: string; due_date: string | null; overdue: boolean };

export type ReportProject = {
  id: string;
  name: string;
  client: string;
  active: boolean;
  status: ReportStatus;
  headline: string;
  progress: string[];
  next_steps: string[];
  risks: string[];
  waiting_on_client: ReportItem[];
  waiting_on_us: ReportItem[];
  done_this_week: string[];
  metrics: {
    questions: number;
    answered_by_assistant: number;
    sent_to_team: number;
    answered_by_team: number;
    open_questions: number;
    oldest_open_days: number | null;
    items_done: number;
    overdue: number;
    sources_added: number;
  };
};

export type PortfolioReport = {
  title: string;
  period: { start: string; end: string };
  generated_at: string;
  summary: string[];
  projects: ReportProject[];
};

const DAYS = 7;

type Facts = Omit<ReportProject, "status" | "headline" | "progress" | "next_steps" | "risks"> & {
  open_question_texts: string[];
  sources: { title: string; kind: string; added: string; excerpt: string }[];
};

/** Collects the hard facts for every project over the last 7 days. Nothing here is AI-generated. */
async function gatherFacts(sql: Sql): Promise<Facts[]> {
  const projects = await sql<{ id: string; name: string; client_name: string; active: boolean }[]>`
    SELECT id, name, client_name, active FROM projects ORDER BY active DESC, name`;
  return Promise.all(
    projects.map(async (p) => {
      const [[m], [q], openQs, items, sources] = await Promise.all([
        sql<{ q: number; a: number; e: number }[]>`
          SELECT count(*) FILTER (WHERE m.role = 'user')::int AS q,
                 count(*) FILTER (WHERE m.role = 'assistant' AND m.status = 'answered')::int AS a,
                 count(*) FILTER (WHERE m.role = 'assistant' AND m.status = 'escalated')::int AS e
          FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.project_id = ${p.id} AND m.created_at > now() - (${DAYS}::int * interval '1 day')`,
        sql<{ team: number; open: number; oldest: Date | null }[]>`
          SELECT count(*) FILTER (WHERE status = 'answered' AND answered_at > now() - (${DAYS}::int * interval '1 day'))::int AS team,
                 count(*) FILTER (WHERE status = 'open')::int AS open,
                 min(created_at) FILTER (WHERE status = 'open') AS oldest
          FROM questions WHERE project_id = ${p.id}`,
        sql<{ question: string }[]>`
          SELECT question FROM questions WHERE project_id = ${p.id} AND status = 'open' ORDER BY created_at LIMIT 5`,
        sql<{ title: string; owner: string; owner_name: string; due_date: string | null; status: string; overdue: boolean; done_recent: boolean }[]>`
          SELECT title, owner, owner_name, to_char(due_date, 'YYYY-MM-DD') AS due_date, status,
                 (status = 'open' AND due_date < current_date) AS overdue,
                 (status = 'done' AND done_at > now() - (${DAYS}::int * interval '1 day')) AS done_recent
          FROM action_items
          WHERE project_id = ${p.id}
            AND (status = 'open' OR (status = 'done' AND done_at > now() - (${DAYS}::int * interval '1 day')))
          ORDER BY due_date NULLS LAST, created_at`,
        sql<{ title: string; kind: string; created_at: Date; excerpt: string }[]>`
          SELECT title, kind, created_at, left(content, 2500) AS excerpt FROM documents
          WHERE project_id = ${p.id} AND created_at > now() - (${DAYS}::int * interval '1 day')
          ORDER BY created_at DESC LIMIT 10`,
      ]);
      const toItem = (i: (typeof items)[number]): ReportItem => ({ title: i.title, owner_name: i.owner_name, due_date: i.due_date, overdue: i.overdue });
      const open = items.filter((i) => i.status === "open");
      return {
        id: p.id,
        name: p.name,
        client: p.client_name,
        active: p.active,
        waiting_on_client: open.filter((i) => i.owner === "client").map(toItem),
        waiting_on_us: open.filter((i) => i.owner === "us").map(toItem),
        done_this_week: items.filter((i) => i.done_recent).map((i) => i.title),
        open_question_texts: openQs.map((x) => x.question),
        sources: sources.map((s) => ({ title: s.title, kind: s.kind, added: new Date(s.created_at).toISOString().slice(0, 10), excerpt: s.excerpt })),
        metrics: {
          questions: m.q,
          answered_by_assistant: m.a,
          sent_to_team: m.e,
          answered_by_team: q.team,
          open_questions: q.open,
          oldest_open_days: q.oldest ? Math.floor((Date.now() - new Date(q.oldest).getTime()) / 86_400_000) : null,
          items_done: items.filter((i) => i.done_recent).length,
          overdue: open.filter((i) => i.overdue).length,
          sources_added: sources.length,
        },
      };
    }),
  );
}

function quiet(f: Facts) {
  const x = f.metrics;
  return x.questions === 0 && x.items_done === 0 && x.sources_added === 0 && x.answered_by_team === 0;
}

function fallbackStatus(f: Facts): ReportStatus {
  if (quiet(f) && !f.waiting_on_client.length && !f.waiting_on_us.length && !f.metrics.open_questions) return "No activity";
  if (f.metrics.overdue > 0 || (f.metrics.oldest_open_days ?? 0) >= 3) return "At risk";
  return "On track";
}

const WRITE_TOOL = {
  name: "write_report",
  description: "Write the narrative parts of the weekly report.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "array", items: { type: "string" }, description: "3–5 bullet points for the whole portfolio: what moved, what's stuck, what needs a decision." },
      projects: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            status: { type: "string", enum: ["On track", "At risk", "Blocked", "No activity"] },
            headline: { type: "string", description: "One sentence: where the project stands." },
            progress: { type: "array", items: { type: "string" }, description: "What happened this week, from emails, completed items and new documents. 0–5 bullets." },
            next_steps: { type: "array", items: { type: "string" }, description: "The next concrete steps, with dates where known. 0–4 bullets." },
            risks: { type: "array", items: { type: "string" }, description: "Blockers or risks, e.g. overdue items or clients waiting on answers. 0–3 bullets." },
          },
          required: ["id", "status", "headline"],
        },
      },
    },
    required: ["summary", "projects"],
  },
};

/** Builds the weekly report: facts from the database, narrative from Claude. */
export async function buildPortfolioReport(sql: Sql): Promise<PortfolioReport> {
  const facts = await gatherFacts(sql);
  if (!facts.length) throw new Error("There are no projects yet.");
  const end = new Date();
  const start = new Date(end.getTime() - DAYS * 86_400_000);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const briefing = facts.map((f) => ({
    id: f.id,
    project: f.name,
    client: f.client,
    client_link_active: f.active,
    metrics: f.metrics,
    done_this_week: f.done_this_week,
    waiting_on_client: f.waiting_on_client,
    waiting_on_us: f.waiting_on_us,
    unanswered_client_questions: f.open_question_texts,
    new_sources_this_week: f.sources,
  }));

  let written: { summary?: string[]; projects?: { id?: string; status?: string; headline?: string; progress?: string[]; next_steps?: string[]; risks?: string[] }[] } = {};
  const res = await callClaude({
    model: MODEL,
    max_tokens: 9000,
    tools: [WRITE_TOOL],
    tool_choice: { type: "auto" },
    system: `You write a short, factual weekly status report across a team's client projects (bank integrations and deployments), for the team and their manager. Period: ${fmt(start)} to ${fmt(end)}.
- Use ONLY the facts provided. Never invent progress, dates or names. If a project had no activity, say so plainly.
- Status: "Blocked" if work can't move until something outstanding arrives; "At risk" if items are overdue or clients have waited 3+ days for answers; "On track" otherwise; "No activity" if nothing happened and nothing is open.
- Be specific and brief: name the item, the owner and the date. Plain business English, no filler.
- Write progress from the new sources (emails, documents) and completed items; next steps from open items and the latest emails.
- Always answer by calling the write_report tool, with one entry per project id.`,
    messages: [{ role: "user", content: `Projects and this week's facts (JSON):\n${JSON.stringify(briefing).slice(0, 180_000)}` }],
  });
  const tool = res.content.find((b) => b.type === "tool_use" && b.name === "write_report");
  if (tool?.input) written = tool.input as typeof written;

  const byId = new Map((written.projects || []).map((p) => [p.id, p]));
  const statuses: ReportStatus[] = ["On track", "At risk", "Blocked", "No activity"];
  const projects: ReportProject[] = facts.map((f) => {
    const w: { status?: string; headline?: string; progress?: string[]; next_steps?: string[]; risks?: string[] } = byId.get(f.id) || {};
    const status = statuses.includes(w.status as ReportStatus) ? (w.status as ReportStatus) : fallbackStatus(f);
    const clean = (a?: string[]) => (Array.isArray(a) ? a.filter((s) => typeof s === "string" && s.trim()).slice(0, 6) : []);
    return {
      id: f.id,
      name: f.name,
      client: f.client,
      active: f.active,
      status,
      headline: (w.headline || "").trim() || (status === "No activity" ? "No activity this week." : "See the details below."),
      progress: clean(w.progress),
      next_steps: clean(w.next_steps),
      risks: clean(w.risks),
      waiting_on_client: f.waiting_on_client.slice(0, 8),
      waiting_on_us: f.waiting_on_us.slice(0, 8),
      done_this_week: f.done_this_week.slice(0, 8),
      metrics: f.metrics,
    };
  });
  const order: Record<ReportStatus, number> = { Blocked: 0, "At risk": 1, "On track": 2, "No activity": 3 };
  projects.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));

  return {
    title: `Weekly project report, ${fmt(start)} – ${fmt(end)}`,
    period: { start: start.toISOString(), end: end.toISOString() },
    generated_at: end.toISOString(),
    summary: (written.summary || []).filter((s) => typeof s === "string" && s.trim()).slice(0, 6),
    projects,
  };
}
