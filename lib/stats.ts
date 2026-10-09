import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

export type Health = { level: "good" | "warning" | "critical" | "paused"; label: string; reason: string };

export type Totals = {
  questions30: number;
  questionsPrev30: number;
  answered30: number;
  escalated30: number;
  answerRate30: number | null; // 0–1, null when no questions
  answerRatePrev30: number | null;
  openCount: number;
  avgReplyHours30: number | null; // how long the team took to answer escalated questions
  answeredByTeam30: number;
};

export type DayPoint = { day: string; answered: number; escalated: number };

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Last `n` calendar days (UTC) as YYYY-MM-DD, oldest first. */
export function lastDays(n: number): string[] {
  const today = new Date();
  return Array.from({ length: n }, (_, i) => isoDay(new Date(today.getTime() - (n - 1 - i) * DAY)));
}

const rate = (a: number, e: number) => (a + e > 0 ? a / (a + e) : null);

/** Headline numbers for the whole portfolio, or one project. */
export async function getTotals(sql: Sql, projectId?: string): Promise<Totals> {
  const byProject = projectId ? sql`AND c.project_id = ${projectId}` : sql``;
  const byProjectQ = projectId ? sql`AND q.project_id = ${projectId}` : sql``;
  const [m] = await sql<
    { q30: number; qprev: number; a30: number; e30: number; aprev: number; eprev: number }[]
  >`
    SELECT
      count(*) FILTER (WHERE m.role = 'user' AND m.created_at > now() - interval '30 days')::int AS q30,
      count(*) FILTER (WHERE m.role = 'user' AND m.created_at <= now() - interval '30 days')::int AS qprev,
      count(*) FILTER (WHERE m.role = 'assistant' AND m.status = 'answered' AND m.created_at > now() - interval '30 days')::int AS a30,
      count(*) FILTER (WHERE m.role = 'assistant' AND m.status = 'escalated' AND m.created_at > now() - interval '30 days')::int AS e30,
      count(*) FILTER (WHERE m.role = 'assistant' AND m.status = 'answered' AND m.created_at <= now() - interval '30 days')::int AS aprev,
      count(*) FILTER (WHERE m.role = 'assistant' AND m.status = 'escalated' AND m.created_at <= now() - interval '30 days')::int AS eprev
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.created_at > now() - interval '60 days' ${byProject}`;
  const [q] = await sql<{ open: number; answered: number; avg_hours: number | null }[]>`
    SELECT
      count(*) FILTER (WHERE q.status = 'open')::int AS open,
      count(*) FILTER (WHERE q.status = 'answered' AND q.answered_at > now() - interval '30 days')::int AS answered,
      (avg(extract(epoch FROM (q.answered_at - q.created_at)) / 3600)
        FILTER (WHERE q.status = 'answered' AND q.answered_at > now() - interval '30 days'))::float AS avg_hours
    FROM questions q
    WHERE true ${byProjectQ}`;
  return {
    questions30: m.q30,
    questionsPrev30: m.qprev,
    answered30: m.a30,
    escalated30: m.e30,
    answerRate30: rate(m.a30, m.e30),
    answerRatePrev30: rate(m.aprev, m.eprev),
    openCount: q.open,
    avgReplyHours30: q.avg_hours,
    answeredByTeam30: q.answered,
  };
}

/** Questions per day over the last 30 days, split by who answered. */
export async function getDaily(sql: Sql, projectId?: string, days = 30): Promise<DayPoint[]> {
  const byProject = projectId ? sql`AND c.project_id = ${projectId}` : sql``;
  const rows = await sql<{ day: string; answered: number; escalated: number }[]>`
    SELECT to_char(date_trunc('day', m.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE m.status = 'answered')::int AS answered,
      count(*) FILTER (WHERE m.status = 'escalated')::int AS escalated
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.role = 'assistant' AND m.created_at > now() - (${days}::int * interval '1 day') ${byProject}
    GROUP BY 1`;
  const map = new Map<string, { answered: number; escalated: number }>(rows.map((r) => [r.day, r] as [string, { answered: number; escalated: number }]));
  return lastDays(days).map((day) => ({ day, answered: map.get(day)?.answered || 0, escalated: map.get(day)?.escalated || 0 }));
}

export function healthOf(p: {
  active: boolean;
  doc_count: number;
  open_count: number;
  oldest_open: Date | string | null;
  answered: number;
  escalated: number;
}): Health {
  if (!p.active) return { level: "paused", label: "Paused", reason: "Client link is switched off" };
  const waitingHours = p.oldest_open ? (Date.now() - new Date(p.oldest_open).getTime()) / 3_600_000 : 0;
  if (p.open_count > 0 && waitingHours >= 48) {
    const days = Math.floor(waitingHours / 24);
    return { level: "critical", label: "Needs attention", reason: `A client has waited ${days} day${days === 1 ? "" : "s"} for an answer` };
  }
  const total = p.answered + p.escalated;
  if (total >= 5 && p.answered / total < 0.6) {
    return { level: "critical", label: "Needs attention", reason: `The assistant answered only ${Math.round((p.answered / total) * 100)}% — add documents` };
  }
  if (p.open_count > 0) return { level: "warning", label: "Waiting on you", reason: `${p.open_count} question${p.open_count === 1 ? "" : "s"} to answer` };
  if (p.doc_count === 0) return { level: "warning", label: "Set up", reason: "No documents yet — the assistant can't answer" };
  return { level: "good", label: "On track", reason: total ? "All questions handled" : "Ready for client questions" };
}

export async function getDashboard(sql: Sql) {
  const [totals, daily, projectsRaw, sparkRows, needsYou] = await Promise.all([
    getTotals(sql),
    getDaily(sql),
    sql<
      {
        id: string;
        name: string;
        client_name: string;
        slug: string;
        active: boolean;
        created_at: Date;
        doc_count: number;
        conversation_count: number;
        last_activity: Date | null;
        open_count: number;
        oldest_open: Date | null;
        answered: number;
        escalated: number;
      }[]
    >`
      SELECT p.id, p.name, p.client_name, p.slug, p.active, p.created_at,
        (SELECT count(*)::int FROM documents d WHERE d.project_id = p.id) AS doc_count,
        (SELECT count(*)::int FROM conversations c WHERE c.project_id = p.id) AS conversation_count,
        (SELECT max(c.last_message_at) FROM conversations c WHERE c.project_id = p.id) AS last_activity,
        (SELECT count(*)::int FROM questions q WHERE q.project_id = p.id AND q.status = 'open') AS open_count,
        (SELECT min(q.created_at) FROM questions q WHERE q.project_id = p.id AND q.status = 'open') AS oldest_open,
        coalesce(s.answered, 0) AS answered, coalesce(s.escalated, 0) AS escalated
      FROM projects p
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE m.status = 'answered')::int AS answered,
               count(*) FILTER (WHERE m.status = 'escalated')::int AS escalated
        FROM messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE c.project_id = p.id AND m.role = 'assistant' AND m.created_at > now() - interval '30 days'
      ) s ON true
      ORDER BY p.active DESC, p.created_at DESC`,
    sql<{ project_id: string; day: string; n: number }[]>`
      SELECT c.project_id, to_char(date_trunc('day', m.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.role = 'user' AND m.created_at > now() - interval '14 days'
      GROUP BY 1, 2`,
    sql<{ id: string; project_id: string; project_name: string; question: string; visitor_email: string; created_at: Date }[]>`
      SELECT q.id, q.project_id, p.name AS project_name, q.question, q.visitor_email, q.created_at
      FROM questions q JOIN projects p ON p.id = q.project_id
      WHERE q.status = 'open'
      ORDER BY q.created_at ASC
      LIMIT 8`,
  ]);

  const days14 = lastDays(14);
  const spark = new Map<string, Map<string, number>>();
  for (const r of sparkRows) {
    if (!spark.has(r.project_id)) spark.set(r.project_id, new Map());
    spark.get(r.project_id)!.set(r.day, r.n);
  }

  const order = { critical: 0, warning: 1, good: 2, paused: 3 } as const;
  const projects = projectsRaw
    .map((p) => ({
      ...p,
      answer_rate: rate(p.answered, p.escalated),
      health: healthOf(p),
      spark: days14.map((d) => spark.get(p.id)?.get(d) || 0),
    }))
    .sort((a, b) => order[a.health.level] - order[b.health.level]);

  return { totals, daily, projects, needsYou, sparkDays: days14 };
}
