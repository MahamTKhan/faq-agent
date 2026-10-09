import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ itemId: string }> };

const STATUSES = ["suggested", "open", "done", "dismissed"];

/** Edit an item, or move it between suggested / open / done / dismissed. */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { itemId } = await ctx.params;
  if (!isUuid(itemId)) throw new HttpError(404, "Item not found.");
  const body = await readJson(req);
  const sql = await db();
  const [cur] = await sql`SELECT *, to_char(due_date, 'YYYY-MM-DD') AS due_text FROM action_items WHERE id = ${itemId}`;
  if (!cur) throw new HttpError(404, "Item not found.");

  const status = STATUSES.includes(str(body.status, 20)) ? str(body.status, 20) : cur.status;
  const title = typeof body.title === "string" ? str(body.title, 300).trim() || cur.title : cur.title;
  const owner = body.owner === "us" || body.owner === "client" ? body.owner : cur.owner;
  const ownerName = typeof body.owner_name === "string" ? str(body.owner_name, 200).trim() : cur.owner_name;
  let due: string | null = cur.due_text;
  if (body.due_date === null || body.due_date === "") due = null;
  else if (typeof body.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date)) due = body.due_date;
  const doneHint = status === "done" || body.clear_hint === true ? "" : cur.done_hint;

  await sql`
    UPDATE action_items SET status = ${status}, title = ${title}, owner = ${owner}, owner_name = ${ownerName},
      due_date = ${due}, done_hint = ${doneHint},
      done_at = ${status === "done" ? (cur.status === "done" ? cur.done_at : new Date()) : null}
    WHERE id = ${itemId}`;
  return json({ ok: true });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { itemId } = await ctx.params;
  if (!isUuid(itemId)) throw new HttpError(404, "Item not found.");
  const sql = await db();
  await sql`DELETE FROM action_items WHERE id = ${itemId}`;
  return json({ ok: true });
});
