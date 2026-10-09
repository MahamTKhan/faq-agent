import { safeEqual } from "./auth";
import type { db } from "./db";
import { HttpError } from "./http";

type Sql = Awaited<ReturnType<typeof db>>;

export type PublicProject = {
  id: string;
  name: string;
  client_name: string;
  slug: string;
  access_code: string;
  welcome_message: string;
  starter_questions: string;
  notify_email: string;
  active: boolean;
};

export async function projectBySlug(sql: Sql, slug: string): Promise<PublicProject> {
  if (!/^[A-Za-z0-9]{6,40}$/.test(slug)) throw new HttpError(404, "This link isn't valid.");
  const [p] = await sql<PublicProject[]>`
    SELECT id, name, client_name, slug, access_code, welcome_message, starter_questions, notify_email, active
    FROM projects WHERE slug = ${slug}`;
  if (!p || !p.active) throw new HttpError(404, "This link isn't active. Please contact the project team.");
  return p;
}

export function checkAccessCode(p: PublicProject, req: Request) {
  if (!p.access_code) return;
  const given = (req.headers.get("x-access-code") || "").trim();
  if (!given || !safeEqual(given.toLowerCase(), p.access_code.trim().toLowerCase())) {
    throw new HttpError(401, "Access code required.");
  }
}

export function notifyAddress(p: { notify_email: string }): string {
  return (p.notify_email || process.env.ADMIN_EMAIL || "").trim();
}
