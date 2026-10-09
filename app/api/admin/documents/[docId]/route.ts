import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";
import { normalizeKind, reindexDocument } from "@/lib/kb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ docId: string }> };

async function docId(ctx: Ctx) {
  const { docId } = await ctx.params;
  if (!isUuid(docId)) throw new HttpError(404, "Document not found.");
  return docId;
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await docId(ctx);
  const sql = await db();
  const [doc] = await sql`SELECT * FROM documents WHERE id = ${id}`;
  if (!doc) throw new HttpError(404, "Document not found.");
  return json({ document: doc });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await docId(ctx);
  const body = await readJson(req);
  const sql = await db();
  const [cur] = await sql`SELECT * FROM documents WHERE id = ${id}`;
  if (!cur) throw new HttpError(404, "Document not found.");
  const title = typeof body.title === "string" ? str(body.title, 300).trim() || cur.title : cur.title;
  const content = typeof body.content === "string" ? str(body.content, 2_000_000) : cur.content;
  const kind = body.kind ? normalizeKind(body.kind) : cur.kind;
  const shared = typeof body.shared === "boolean" ? body.shared : cur.shared;
  if (!content.trim()) throw new HttpError(400, "A document can't be empty. Delete it instead.");
  await sql`UPDATE documents SET title = ${title}, content = ${content}, kind = ${kind}, shared = ${shared}, updated_at = now() WHERE id = ${id}`;
  if (content !== cur.content) await reindexDocument(sql, id, cur.project_id, content);
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await docId(ctx);
  const sql = await db();
  await sql`DELETE FROM documents WHERE id = ${id}`;
  return json({ ok: true });
});
