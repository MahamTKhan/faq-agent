import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ gid: string }> };

async function gid(ctx: Ctx) {
  const { gid } = await ctx.params;
  if (!isUuid(gid)) throw new HttpError(404, "Document not found.");
  return gid;
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await gid(ctx);
  const sql = await db();
  const [doc] = await sql`SELECT * FROM generated_docs WHERE id = ${id}`;
  if (!doc) throw new HttpError(404, "Document not found.");
  return json({ document: doc });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await gid(ctx);
  const body = await readJson(req);
  const sql = await db();
  const [cur] = await sql`SELECT * FROM generated_docs WHERE id = ${id}`;
  if (!cur) throw new HttpError(404, "Document not found.");
  const title = typeof body.title === "string" ? str(body.title, 200).trim() || cur.title : cur.title;
  const content = typeof body.content === "string" ? str(body.content, 500_000) : cur.content;
  const published = typeof body.published === "boolean" ? body.published : cur.published;
  if (!content.trim()) throw new HttpError(400, "The document can't be empty.");
  await sql`UPDATE generated_docs SET title = ${title}, content = ${content}, published = ${published}, updated_at = now() WHERE id = ${id}`;
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await gid(ctx);
  const sql = await db();
  await sql`DELETE FROM generated_docs WHERE id = ${id}`;
  return json({ ok: true });
});
