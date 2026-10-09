// Admin session helpers. Uses Web Crypto only, so it runs in middleware (edge) and in route handlers.

export const SESSION_COOKIE = "faq_admin";
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(data: string): Promise<string> {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 16) throw new Error("SESSION_SECRET must be set (at least 16 characters).");
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

async function sha256(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return b64url(new Uint8Array(digest));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  return safeEqual(await sha256(input), await sha256(expected));
}

export const SESSION_DAYS = 14;

export async function createSessionToken(): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `admin.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [who, exp, sig] = parts;
  if (who !== "admin" || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  try {
    return safeEqual(await hmac(`${who}.${exp}`), sig);
  } catch {
    return false;
  }
}

/** Reads the session cookie from a request's Cookie header. */
export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
