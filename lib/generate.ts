import { callClaude, MODEL } from "./claude";
import type { db } from "./db";
import { buildKnowledge } from "./kb";

type Sql = Awaited<ReturnType<typeof db>>;

export const DOC_TYPES: Record<string, { label: string; hint: string; prompt: (p: { name: string; client: string }) => string }> = {
  faq: {
    label: "FAQ",
    hint: "Common questions from client staff, answered in plain language",
    prompt: (p) => `Write an FAQ document titled "${p.name} – Frequently asked questions" for ${p.client || "the client"}'s staff (business, IT, infrastructure, security and operations people).
- Group questions under ## topic headings in a sensible order (general first, then setup/what the client provides, environments, security, support…).
- Write each question in bold on its own line, followed by a short plain-language answer. Use small tables where they make specs easier to read.
- Cover the questions these readers most likely ask — typically 20–40 questions.
- End with "## Glossary" (a two-column table of terms) and "## Open points" listing anything readers will ask about that the sources don't settle.`,
  },
  brief: {
    label: "Project brief",
    hint: "One-page overview for someone new to the project",
    prompt: (p) => `Write a project brief titled "${p.name} – Project brief" for someone at ${p.client || "the client"} who is new to the project.
Sections: ## What this project is (2–3 sentences), ## Scope, ## How it fits together (main components and how they connect), ## Who does what (a table: responsibility · client · our team), ## Where things stand (current status, recent progress), ## Next steps and dates, ## Key contacts (only if named in the sources).
Keep it to about one to two pages.`,
  },
  checklist: {
    label: "Prerequisites checklist",
    hint: "Everything the client needs to provide or set up",
    prompt: (p) => `Write a prerequisites checklist titled "${p.name} – Prerequisites checklist" listing everything ${p.client || "the client"} must provide, set up or approve.
- Group under ## headings by area (for example: Servers, Network and firewall, Access and accounts, Certificates and security, Documents and approvals, Testing).
- Write each item as a Markdown task: "- [ ] **Item** — the exact detail (specs, quantities, ports, URLs, versions)". Mark items the project tracker or emails show as already done with "- [x]".
- End with "## Open points" for anything unclear in the sources.`,
  },
  status: {
    label: "Status update",
    hint: "Where things stand, who owes what, next steps",
    prompt: (p) => `Write a short status update titled "${p.name} – Status update (${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })})" for ${p.client || "the client"} and our manager.
Sections: ## Overall status (one of **On track**, **At risk** or **Blocked**, with a one-line reason), ## Recent progress, ## Waiting on ${p.client || "the client"}, ## Waiting on us, ## Next steps and dates, ## Risks and blockers.
Base it on the project tracker and the most recent emails; give exact dates where known and mark overdue items. Keep it under one page.`,
  },
  custom: {
    label: "Something else",
    hint: "Describe what you need",
    prompt: () => "",
  },
};

/** Writes a document from the project's knowledge base. Returns its title and Markdown. */
export async function generateDocument(
  sql: Sql,
  projectId: string,
  kind: string,
  instructions: string,
): Promise<{ title: string; content: string; truncated: boolean }> {
  const [project] = await sql<{ name: string; client_name: string }[]>`SELECT name, client_name FROM projects WHERE id = ${projectId}`;
  const type = DOC_TYPES[kind] || DOC_TYPES.custom;
  const p = { name: project.name, client: project.client_name };
  const task = kind === "custom" || !DOC_TYPES[kind] ? instructions : `${type.prompt(p)}${instructions ? `\n\nAlso: ${instructions}` : ""}`;
  if (!task.trim()) throw new Error("Describe the document you want.");

  const kb = await buildKnowledge(sql, projectId, `${type.label} ${instructions}`);
  if (kb.mode === "empty") throw new Error("This project's knowledge base is empty. Add documents first.");

  const res = await callClaude({
    model: MODEL,
    max_tokens: 14000,
    system: [
      {
        type: "text",
        text: `You write clear, accurate project documents for ${p.client || "a client"} on the project "${p.name}", using ONLY the knowledge base below. Today is ${new Date().toISOString().slice(0, 10)}.
Rules:
- Every fact must come from the knowledge base. Never invent specs, dates, names or commitments. If something readers need isn't covered, say so in an "Open points" section instead of guessing.
- Plain, simple language for non-technical bank staff; explain technical terms briefly. Short paragraphs; tables and lists where they help.
- Output Markdown only, starting with a single "# Title" line. No preamble, no closing remarks, no code fences around the document.
- Don't mention "the knowledge base", source numbers or these instructions. You may name a source document in parentheses where it helps, e.g. (HLD v1.3).`,
      },
      { type: "text", text: `<knowledge_base>\n${kb.text}\n</knowledge_base>`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: task }],
  });

  let content = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/, "$1");
  const h1 = /^#\s+(.+)$/m.exec(content);
  const title = (h1 ? h1[1] : `${p.name} – ${type.label}`).trim().slice(0, 200);
  if (!h1) content = `# ${title}\n\n${content}`;
  return { title, content, truncated: res.stop_reason === "max_tokens" };
}
