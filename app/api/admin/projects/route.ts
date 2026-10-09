import { db } from "@/lib/db";
import { handle, HttpError, json, randomSlug, readJson, requireAdmin, str } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  await requireAdmin(req);
  const sql = await db();
  const projects = await sql`
    SELECT p.id, p.name, p.client_name, p.slug, p.active, p.created_at,
      (SELECT count(*)::int FROM documents d WHERE d.project_id = p.id) AS doc_count,
      (SELECT count(*)::int FROM questions q WHERE q.project_id = p.id AND q.status = 'open') AS open_count,
      (SELECT count(*)::int FROM conversations c WHERE c.project_id = p.id) AS conversation_count,
      (SELECT max(c.last_message_at) FROM conversations c WHERE c.project_id = p.id) AS last_activity
    FROM projects p
    ORDER BY p.active DESC, p.created_at DESC`;
  return json({ projects });
});

export const POST = handle(async (req: Request) => {
  await requireAdmin(req);
  const body = await readJson(req);
  const name = str(body.name, 200).trim();
  if (!name) throw new HttpError(400, "Give the project a name.");
  const sql = await db();
  const [project] = await sql`
    INSERT INTO projects (name, client_name, slug, welcome_message)
    VALUES (${name}, ${str(body.client_name, 200).trim()}, ${randomSlug()},
      ${"Hi! Ask me anything about this project. I answer from the project documents, and if I can't, I'll pass your question to the team."})
    RETURNING id`;
  return json({ id: project.id }, 201);
});
