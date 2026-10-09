import { createSessionToken, passwordMatches, SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientIp, handle, HttpError, rateLimit, readJson, str } from "@/lib/http";

export const runtime = "nodejs";

export const POST = handle(async (req: Request) => {
  if (!process.env.ADMIN_PASSWORD) throw new HttpError(500, "ADMIN_PASSWORD is not set in the environment.");
  const sql = await db();
  await rateLimit(sql, `login:${clientIp(req)}`, 10, 15 * 60, "Too many login attempts. Try again in 15 minutes.");
  const body = await readJson<{ password?: string }>(req);
  if (!(await passwordMatches(str(body.password, 500)))) throw new HttpError(401, "Wrong password.");
  const token = await createSessionToken();
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`,
    },
  });
});
