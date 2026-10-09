import { readSessionCookie, verifySessionToken } from "./auth";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Wraps a route handler so thrown errors become JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      const message = e instanceof Error ? e.message : "Something went wrong";
      return json({ error: message }, 500);
    }
  };
}

export async function requireAdmin(req: Request): Promise<void> {
  if (!(await verifySessionToken(readSessionCookie(req)))) throw new HttpError(401, "Please log in again.");
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export function appUrl(req: Request): string {
  const env = (process.env.APP_URL || "").trim().replace(/\/$/, "");
  if (env) return env.startsWith("http") ? env : `https://${env}`;
  return new URL(req.url).origin;
}

export function appName(): string {
  return process.env.APP_NAME || "Project Desk";
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
}

export function str(v: unknown, max = 100_000): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export function randomSlug(len = 12): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/** Simple sliding-window limiter stored in Postgres (works across serverless instances). */
export async function rateLimit(
  sql: Awaited<ReturnType<typeof import("./db").db>>,
  key: string,
  limit: number,
  windowSeconds: number,
  message = "Too many requests. Please wait a few minutes and try again.",
): Promise<void> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM rate_hits
    WHERE key = ${key} AND at > now() - (${windowSeconds}::int * interval '1 second')`;
  if (row.n >= limit) throw new HttpError(429, message);
  await sql`INSERT INTO rate_hits (key) VALUES (${key})`;
  if (Math.random() < 0.02) await sql`DELETE FROM rate_hits WHERE at < now() - interval '1 day'`;
}
