import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Session auth for the console. Public surfaces stay open: tracking
 * pixels/redirects, unsubscribe, webhooks, push subscribe/track APIs, the
 * push demo page, and the login/bootstrap endpoints.
 * Settings + team management are ADMIN-only (enforced here and in the routes).
 */
const PUBLIC_PREFIXES = [
  "/api/t/",
  "/api/u/",
  "/u/",
  "/api/webhooks/",
  "/api/push/",
  "/api/track",
  "/demo/",
  "/login",
  "/api/auth/login",
  "/api/auth/bootstrap",
  "/sw.js",
  "/_next/",
  "/favicon",
  "/icon",
];

const ADMIN_PREFIXES = ["/settings", "/api/settings/", "/api/users"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (ADMIN_PREFIXES.some((p) => pathname.startsWith(p)) && session.role !== "ADMIN") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "admin only" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
