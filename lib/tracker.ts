import { callClaude, MODEL } from "./claude";
import type { db } from "./db";

type Sql = Awaited<ReturnType<typeof db>>;

export type ActionItem = {
  id: string;
  project_id: string;
  title: string;
  owner: "client" | "us";
  owner_name: string;
  due_date: string | null;
  status: "suggested" | "open" | "done" | "dismissed";
  source_document_id: string | null;
  source_quote: string;
  done_hint: string;
  origin: "manual" | "ai";
  created_at: string;
  done_at: string | null;
};

export const ITEM_COLUMNS = `id, project_id, title, owner, owner_name, to_char(due_date, 'YYYY-MM-DD') AS due_date, status,
  source_document_id, source_quote, done_hint, origin, created_at, done_at`;

const RECORD_TOOL = {
  name: "record_items",
  description: "Record the action items found in the document.",
  input_schema: {
    type: "object",
    properties: {
      new_items: {
        type: "array",
        description: "Concrete actions someone has committed to or been asked to do, that are not already in the existing list.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short imperative, e.g. 'Share production API credentials'. Max ~12 words." },
            owner: { type: "string", enum: ["client", "us"], description: "client = the client/bank side must do it; us = our team (the vendor) must do it." },
            owner_name: { type: "string", description: "Person or team responsible if named, else empty." },
            due_date: { type: "string", description: "YYYY-MM-DD if a date is stated or clearly implied (resolve 'by Friday' from the email's date), else empty." },
            quote: { type: "string", description: "The exact sentence from the document this comes from." },
          },
          required: ["title", "owner"],
        },
      },
      completed: {
        type: "array",
        description: "Existing open items that this document shows are now done.",
        items: {
          type: "object",
          properties: { id: { type: "string" }, evidence: { type: "string", description: "The sentence showing it is done." } },
          required: ["id", "evidence"],
        },
      },
    },
    required: ["new_items", "completed"],
  },
};

/**
 * Reads one document (usually an email thread) and records the actions it mentions as *suggested* items
 * for the admin to confirm. Also flags open items the document shows as done.
 */
export async function extractActionItems(sql: Sql, documentId: string): Promise<{ added: number; completed: number }> {
  const [doc] = await sql<{ id: string; project_id: string; title: string; kind: string; content: string; created_at: Date }[]>`
    SELECT id, project_id, title, kind, content, created_at FROM documents WHERE id = ${documentId}`;
  if (!doc) return { added: 0, completed: 0 };
  const [project] = await sql<{ name: string; client_name: string }[]>`SELECT name, client_name FROM projects WHERE id = ${doc.project_id}`;
  const existing = await sql<{ id: string; title: string; owner: string; status: string }[]>`
    SELECT id, title, owner, status FROM action_items WHERE project_id = ${doc.project_id} AND status IN ('open', 'suggested')`;

  const today = new Date().toISOString().slice(0, 10);
  const res = await callClaude({
    model: MODEL,
    max_tokens: 4000,
    tools: [RECORD_TOOL],
    tool_choice: { type: "auto" },
    system: `You track who owes what on the project "${project?.name || ""}"${project?.client_name ? ` between our team (the vendor) and the client, ${project.client_name}` : ""}. Today is ${today}.
Find concrete action items in the document: things someone was asked to do or committed to do (provide access, share documents, set up servers, send credentials, confirm dates, review, approve…).
- Ignore vague intentions, pleasantries, things already completed in the same document, and generic background from specifications.
- owner "client" = the client/bank side must act; owner "us" = our team must act. Use signatures, email domains and context to decide.
- Don't repeat items already in the existing list (even if worded differently).
- If the document shows an existing open item is now done, list it under "completed" with the evidence.
- At most 12 new items. Always answer by calling the record_items tool, with empty arrays if there is nothing.`,
    messages: [
      {
        role: "user",
        content: `Existing items:\n${existing.length ? existing.map((e) => `- [${e.id}] (${e.owner}) ${e.title}`).join("\n") : "(none)"}\n\nDocument "${doc.title}" (added ${new Date(doc.created_at).toISOString().slice(0, 10)}):\n<document>\n${doc.content.slice(0, 60_000)}\n</document>`,
      },
    ],
  });

  const tool = res.content.find((b) => b.type === "tool_use" && b.name === "record_items");
  const input = (tool?.input || {}) as {
    new_items?: { title?: string; owner?: string; owner_name?: string; due_date?: string; quote?: string }[];
    completed?: { id?: string; evidence?: string }[];
  };

  const seen = new Set(existing.map((e) => e.title.trim().toLowerCase()));
  let added = 0;
  for (const it of (input.new_items || []).slice(0, 12)) {
    const title = (it.title || "").trim().slice(0, 300);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    const due = /^\d{4}-\d{2}-\d{2}$/.test(it.due_date || "") ? it.due_date! : null;
    await sql`
      INSERT INTO action_items (project_id, title, owner, owner_name, due_date, status, source_document_id, source_quote, origin)
      VALUES (${doc.project_id}, ${title}, ${it.owner === "us" ? "us" : "client"}, ${(it.owner_name || "").slice(0, 200)},
        ${due}, 'suggested', ${doc.id}, ${(it.quote || "").slice(0, 1000)}, 'ai')`;
    added++;
  }

  let completed = 0;
  const openIds = new Set(existing.filter((e) => e.status === "open").map((e) => e.id));
  for (const c of input.completed || []) {
    if (!c.id || !openIds.has(c.id)) continue;
    await sql`UPDATE action_items SET done_hint = ${(c.evidence || "Mentioned as done").slice(0, 1000)} WHERE id = ${c.id}`;
    completed++;
  }
  return { added, completed };
}

/** Open items as a short text block, so the assistant can answer "what's pending?" questions. */
export async function trackerSummary(sql: Sql, projectId: string): Promise<string> {
  const items = await sql<{ title: string; owner: string; owner_name: string; due_date: string | null }[]>`
    SELECT title, owner, owner_name, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM action_items
    WHERE project_id = ${projectId} AND status = 'open'
    ORDER BY due_date NULLS LAST, created_at`;
  if (!items.length) return "";
  const line = (i: (typeof items)[number]) => `- ${i.title}${i.owner_name ? ` (${i.owner_name})` : ""}${i.due_date ? `, due ${i.due_date}` : ""}`;
  const client = items.filter((i) => i.owner === "client");
  const us = items.filter((i) => i.owner === "us");
  return [
    `Open action items as of ${new Date().toISOString().slice(0, 10)}, maintained by the project team:`,
    client.length ? `Waiting on the client:\n${client.map(line).join("\n")}` : "Waiting on the client: nothing.",
    us.length ? `Waiting on our team:\n${us.map(line).join("\n")}` : "Waiting on our team: nothing.",
  ].join("\n\n");
}
