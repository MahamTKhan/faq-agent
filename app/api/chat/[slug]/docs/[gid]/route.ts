import { db } from "@/lib/db";
import { handle, HttpError, isUuid, json } from "@/lib/http";
import { checkAccessCode, projectBySlug } from "@/lib/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; gid: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const { slug, gid } = await ctx.params;
  const sql = await db();
  const project = await projectBySlug(sql, slug);
  checkAccessCode(project, req);
  if (!isUuid(gid)) throw new HttpError(404, "Document not found.");
  const [doc] = await sql`
    SELECT id, title, content, updated_at FROM generated_docs WHERE id = ${gid} AND project_id = ${project.id} AND published`;
  if (!doc) throw new HttpError(404, "Document not found.");
  return json({ document: doc });
});
