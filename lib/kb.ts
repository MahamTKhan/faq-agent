import type { db } from "./db";
import { trackerSummary } from "./tracker";

type Sql = Awaited<ReturnType<typeof db>>;

export const DOC_KINDS = ["document", "email", "faq", "note"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const normalizeKind = (k: unknown): DocKind =>
  (DOC_KINDS as readonly string[]).includes(String(k)) ? (k as DocKind) : "document";

/** Splits text into ~1,800-character passages on paragraph boundaries, with a little overlap. */
export function chunkText(text: string, size = 1800, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const paras = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
  };
  for (const p of paras) {
    if (p.length > size) {
      // Very long paragraph: hard-split it.
      push();
      cur = "";
      for (let i = 0; i < p.length; i += size - overlap) chunks.push(p.slice(i, i + size));
      continue;
    }
    if ((cur + "\n\n" + p).length > size) {
      push();
      cur = cur.slice(-overlap) + "\n\n" + p;
    } else {
      cur = cur ? cur + "\n\n" + p : p;
    }
  }
  push();
  return chunks;
}

/** Re-indexes one document's passages for keyword search. */
export async function reindexDocument(sql: Sql, documentId: string, projectId: string, content: string) {
  await sql`DELETE FROM chunks WHERE document_id = ${documentId}`;
  const parts = chunkText(content);
  if (!parts.length) return;
  const rows = parts.map((c, i) => ({ project_id: projectId, document_id: documentId, position: i, content: c }));
  for (let i = 0; i < rows.length; i += 200) {
    await sql`INSERT INTO chunks ${sql(rows.slice(i, i + 200), "project_id", "document_id", "position", "content")}`;
  }
}

export async function createDocument(
  sql: Sql,
  projectId: string,
  input: { title: string; kind: DocKind; content: string; sourceName?: string; shared?: boolean },
) {
  const [doc] = await sql<{ id: string }[]>`
    INSERT INTO documents (project_id, title, kind, source_name, content, shared)
    VALUES (${projectId}, ${input.title}, ${input.kind}, ${input.sourceName || ""}, ${input.content}, ${input.shared === true})
    RETURNING id`;
  await reindexDocument(sql, doc.id, projectId, input.content);
  return doc.id;
}

type DocRow = { id: string; project_id: string; title: string; kind: string; content: string; updated_at: Date; shared: boolean };

const KIND_LABEL: Record<string, string> = {
  document: "Document",
  email: "Email thread",
  faq: "Answered question (confirmed by the project team)",
  note: "Note from the project team",
};

const esc = (s: string) => s.replace(/"/g, "'");

function formatDoc(d: { title: string; kind: string; updated_at: Date; shared?: boolean }, body: string, n: number) {
  const date = new Date(d.updated_at).toISOString().slice(0, 10);
  const type = `${KIND_LABEL[d.kind] || d.kind}${d.shared ? " — shared team knowledge that applies to all projects" : ""}`;
  return `<source id="${n}" title="${esc(d.title)}" type="${type}" updated="${date}">\n${body}\n</source>`;
}

function withTracker(text: string, tracker: string, n: number) {
  if (!tracker) return text;
  const block = `<source id="${n}" title="Project tracker" type="Live list of open action items, kept by the project team">\n${tracker}\n</source>`;
  return text ? `${text}\n\n${block}` : block;
}

/**
 * Builds the knowledge-base text sent to the model.
 * Small knowledge bases are sent whole (best answers, and cached between questions);
 * large ones are keyword-searched and only the best passages are sent.
 */
export async function buildKnowledge(
  sql: Sql,
  projectId: string,
  query: string,
): Promise<{ text: string; mode: "full" | "search" | "empty"; docCount: number }> {
  const [docs, tracker] = await Promise.all([
    sql<DocRow[]>`
      SELECT id, project_id, title, kind, content, updated_at, shared FROM documents
      WHERE project_id = ${projectId} OR shared
      ORDER BY (kind = 'faq') DESC, updated_at DESC`,
    trackerSummary(sql, projectId),
  ]);
  if (!docs.length && !tracker) return { text: "", mode: "empty", docCount: 0 };

  const budget = Number(process.env.MAX_CONTEXT_CHARS) || 400_000;
  const total = docs.reduce((n, d) => n + d.content.length, 0);
  if (total <= budget) {
    // Stable order so the prompt cache can be reused between questions.
    const ordered = [...docs].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return {
      text: withTracker(ordered.map((d, i) => formatDoc(d, d.content, i + 1)).join("\n\n"), tracker, ordered.length + 1),
      mode: "full",
      docCount: docs.length,
    };
  }

  const words = Array.from(new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])).slice(0, 40);
  type Hit = { document_id: string; position: number; content: string; rank: number };
  let hits: Hit[] = [];
  if (words.length) {
    const tsq = words.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean).join(" | ");
    hits = await sql<Hit[]>`
      SELECT c.document_id, c.position, c.content, ts_rank(c.tsv, q) AS rank
      FROM chunks c, to_tsquery('english', ${tsq}) q
      WHERE (c.project_id = ${projectId} OR c.document_id IN (SELECT id FROM documents WHERE shared)) AND c.tsv @@ q
      ORDER BY rank DESC
      LIMIT 80`;
  }

  const target = Math.floor(budget * 0.5);
  const byDoc = new Map<string, Hit[]>();
  let used = 0;
  for (const h of hits) {
    if (used + h.content.length > target) break;
    used += h.content.length;
    byDoc.set(h.document_id, [...(byDoc.get(h.document_id) || []), h]);
  }
  // Confirmed Q&A entries are short and valuable: include as many as fit.
  for (const d of docs) {
    if (d.kind !== "faq" || byDoc.has(d.id)) continue;
    if (used + d.content.length > budget * 0.7) break;
    used += d.content.length;
    byDoc.set(d.id, [{ document_id: d.id, position: 0, content: d.content, rank: 0 }]);
  }

  const parts: string[] = [];
  let n = 0;
  for (const d of docs) {
    const hs = byDoc.get(d.id);
    if (!hs) continue;
    const body = hs
      .sort((a, b) => a.position - b.position)
      .map((h) => h.content)
      .join("\n\n[…]\n\n");
    parts.push(formatDoc(d, body, ++n));
  }
  const list = docs.map((d) => `- ${d.title}`).join("\n");
  const header =
    `The full knowledge base is too large to include, so only the passages most relevant to the latest question are shown below. ` +
    `If the answer is not in these passages, treat it as not found. All documents in the knowledge base:\n${list}\n\n`;
  return { text: withTracker(header + parts.join("\n\n"), tracker, n + 1), mode: "search", docCount: docs.length };
}
