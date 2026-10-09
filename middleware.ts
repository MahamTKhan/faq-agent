import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please log in again." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
