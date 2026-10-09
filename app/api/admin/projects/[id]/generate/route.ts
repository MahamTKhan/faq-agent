import { db } from "@/lib/db";
import { generateDocument } from "@/lib/generate";
import { handle, HttpError, isUuid, json, readJson, requireAdmin, str } from "@/lib/http";

export const runtime = "nodejs";
// Writing a long document can take a couple of minutes.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new HttpError(404, "Project not found.");
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(500, "ANTHROPIC_API_KEY is not set.");
  const body = await readJson(req);
  const kind = str(body.kind, 30) || "custom";
  const instructions = str(body.instructions, 4000).trim();
  const sql = await db();
  const [project] = await sql`SELECT id FROM projects WHERE id = ${id}`;
  if (!project) throw new HttpError(404, "Project not found.");
  let out;
  try {
    out = await generateDocument(sql, id, kind, instructions);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Couldn't write the document.");
  }
  const [doc] = await sql`
    INSERT INTO generated_docs (project_id, kind, title, content)
    VALUES (${id}, ${kind}, ${out.title}, ${out.content})
    RETURNING id`;
  return json({ id: doc.id, truncated: out.truncated }, 201);
});
