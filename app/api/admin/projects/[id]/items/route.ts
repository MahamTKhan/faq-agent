import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";
import { ITEM_COLUMNS } from "@/lib/tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function projectId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new HttpError(404, "Project not found.");
  return id;
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await projectId(ctx);
  const sql = await db();
  const items = await sql.unsafe(
    `SELECT ${ITEM_COLUMNS} FROM action_items WHERE project_id = $1 AND status <> 'dismissed'
     ORDER BY (status = 'suggested') DESC, (status = 'done'), due_date NULLS LAST, created_at DESC`,
    [id],
  );
  return json({ items });
});

/** Adds an item by hand (it starts as open). */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await projectId(ctx);
  const body = await readJson(req);
  const title = str(body.title, 300).trim();
  if (!title) throw new HttpError(400, "Describe the item first.");
  const due = /^\d{4}-\d{2}-\d{2}$/.test(str(body.due_date, 20)) ? str(body.due_date, 20) : null;
  const sql = await db();
  const [item] = await sql`
    INSERT INTO action_items (project_id, title, owner, owner_name, due_date, status, origin)
    VALUES (${id}, ${title}, ${body.owner === "us" ? "us" : "client"}, ${str(body.owner_name, 200).trim()}, ${due}, 'open', 'manual')
    RETURNING id`;
  return json({ id: item.id }, 201);
});
