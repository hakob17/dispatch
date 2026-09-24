import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { audit, describePath } from "@/lib/audit";
import { clientIp } from "@/lib/rateLimit";
import { sessionStillValid } from "@/lib/sessionCheck";

/**
 * Session auth for the console. Public surfaces stay open: tracking
 * pixels/redirects, unsubscribe, webhooks, push subscribe/track APIs, the
 * push demo page, and the login/bootstrap endpoints. The SDK (/api/sdk/) and
 * server (/api/v1/) APIs authenticate with API keys inside their routes.
 * Settings + team management are ADMIN-only (enforced here and in the routes).
 * Every state-changing console request is written to the audit log.
 */
const PUBLIC_PREFIXES = [
  "/api/t/",
  "/api/u/",
  "/u/",
  "/api/webhooks/",
  "/api/push/",
  "/api/track",
  "/api/sdk/",
  "/api/v1/",
  "/api/integrations/", // API-key auth in the route
  "/api/health",
  "/demo/",
  "/login",
  "/api/auth/login",
  "/api/auth/bootstrap",
  "/api/auth/mfa/", // pending-token or session checked in the routes
  "/api/auth/sso/",
  "/sw.js",
  "/_next/",
  "/favicon",
  "/icon",
];

const ADMIN_PREFIXES = ["/settings", "/api/settings/", "/api/users"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const signed = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const session = signed && (await sessionStillValid(signed)) ? signed : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const mutating = pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method);
  const denied = ADMIN_PREFIXES.some((p) => pathname.startsWith(p)) && session.role !== "ADMIN";

  if (mutating || denied) {
    const { route, entityType, entityId } = describePath(pathname);
    // Not awaited: the audit write must not slow the request down
    void audit({
      userId: session.uid,
      userEmail: session.email,
      action: `${req.method} ${route}`,
      entityType,
      entityId,
      status: denied ? 403 : null,
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
      meta: denied ? { denied: true } : undefined,
    });
  }

  if (denied) {
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
