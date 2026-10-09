import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}
