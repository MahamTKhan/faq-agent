import { db } from "@/lib/db";
import { handle, json } from "@/lib/http";
import { checkAccessCode, projectBySlug } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

/** What the client sees besides the chat: confirmed open items and published documents. */
export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const sql = await db();
  const project = await projectBySlug(sql, slug);
  checkAccessCode(project, req);
  const [items, docs] = await Promise.all([
    sql`SELECT id, title, owner, owner_name, to_char(due_date, 'YYYY-MM-DD') AS due_date
        FROM action_items WHERE project_id = ${project.id} AND status = 'open'
        ORDER BY due_date NULLS LAST, created_at`,
    sql`SELECT id, kind, title, updated_at FROM generated_docs WHERE project_id = ${project.id} AND published ORDER BY updated_at DESC`,
  ]);
  return json({ items, docs });
});
