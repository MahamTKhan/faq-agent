import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, requireAdmin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ cid: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { cid } = await ctx.params;
  if (!isUuid(cid)) throw new HttpError(404, "Conversation not found.");
  const sql = await db();
  const [conversation] = await sql`SELECT * FROM conversations WHERE id = ${cid}`;
  if (!conversation) throw new HttpError(404, "Conversation not found.");
  const messages = await sql`SELECT id::text, role, content, status, sources, created_at FROM messages WHERE conversation_id = ${cid} ORDER BY id`;
  return json({ conversation, messages });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { cid } = await ctx.params;
  if (!isUuid(cid)) throw new HttpError(404, "Conversation not found.");
  const sql = await db();
  await sql`DELETE FROM conversations WHERE id = ${cid}`;
  return json({ ok: true });
});
