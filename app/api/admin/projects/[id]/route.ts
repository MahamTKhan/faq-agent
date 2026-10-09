import { db } from "@/lib/db";
import { handle, HttpError, isEmail, isUuid, json, randomSlug, readJson, requireAdmin, str } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadId(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new HttpError(404, "Project not found.");
  return id;
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await loadId(ctx);
  const sql = await db();
  const [project] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (!project) throw new HttpError(404, "Project not found.");
  const [documents, questions, conversations] = await Promise.all([
    sql`SELECT id, title, kind, source_name, length(content)::int AS chars, created_at, updated_at
        FROM documents WHERE project_id = ${id} ORDER BY updated_at DESC`,
    sql`SELECT * FROM questions WHERE project_id = ${id}
        ORDER BY (status = 'open') DESC, created_at DESC LIMIT 300`,
    sql`SELECT c.id, c.visitor_name, c.visitor_email, c.created_at, c.last_message_at,
          (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id) AS message_count,
          (SELECT m.content FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.id LIMIT 1) AS first_question,
          (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.status = 'escalated') AS escalated_count
        FROM conversations c WHERE c.project_id = ${id}
        ORDER BY c.last_message_at DESC LIMIT 300`,
  ]);
  return json({ project, documents, questions, conversations, adminEmail: process.env.ADMIN_EMAIL || "" });
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await loadId(ctx);
  const body = await readJson(req);
  const sql = await db();
  const [current] = await sql`SELECT * FROM projects WHERE id = ${id}`;
  if (!current) throw new HttpError(404, "Project not found.");

  const pick = (k: string, max: number) => (typeof body[k] === "string" ? str(body[k], max).trim() : current[k]);
  const name = pick("name", 200);
  if (!name) throw new HttpError(400, "Project name can't be empty.");
  const notify = pick("notify_email", 300);
  if (notify && !notify.split(",").every((e: string) => isEmail(e.trim()))) throw new HttpError(400, "Notification email doesn't look right.");

  const [project] = await sql`
    UPDATE projects SET
      name = ${name},
      client_name = ${pick("client_name", 200)},
      access_code = ${pick("access_code", 100)},
      welcome_message = ${pick("welcome_message", 2000)},
      starter_questions = ${pick("starter_questions", 4000)},
      notify_email = ${notify},
      active = ${typeof body.active === "boolean" ? body.active : current.active},
      slug = ${body.regenerate_slug === true ? randomSlug() : current.slug}
    WHERE id = ${id}
    RETURNING *`;
  return json({ project });
});

export const DELETE = handle(async (req: Request, ctx: Ctx) => {
  await requireAdmin(req);
  const id = await loadId(ctx);
  const sql = await db();
  await sql`DELETE FROM projects WHERE id = ${id}`;
  return json({ ok: true });
});
