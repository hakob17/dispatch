import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, getSsoConfig, readSsoState, SSO_STATE_COOKIE, SsoDenied, userFromClaims } from "@/lib/sso";
import { finishLogin } from "@/lib/loginFlow";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/rateLimit";

const base = () => process.env.APP_BASE_URL || "http://localhost:3000";

function fail(reason: string, detail?: string): NextResponse {
  const url = new URL("/login", base());
  url.searchParams.set("sso_error", reason);
  if (detail) url.searchParams.set("detail", detail.slice(0, 200));
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: SSO_STATE_COOKIE, path: "/api/auth/sso" });
  return res;
}

/** IdP redirects back here with ?code&state. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("error")) return fail("idp", p.get("error_description") || p.get("error") || undefined);

  const cfg = await getSsoConfig();
  if (!cfg) return fail("not_configured");
  const saved = readSsoState(req.cookies.get(SSO_STATE_COOKIE)?.value);
  if (!saved || saved.state !== p.get("state") || !p.get("code")) return fail("state", "Sign-in took too long or was started elsewhere. Try again.");

  try {
    const claims = await exchangeCode(cfg, p.get("code")!, saved.verifier);
    if (claims.nonce !== saved.nonce) return fail("state", "Sign-in response didn't match this request. Try again.");
    const user = await userFromClaims(cfg, claims);
    const res = NextResponse.redirect(new URL("/", base()));
    res.cookies.delete({ name: SSO_STATE_COOKIE, path: "/api/auth/sso" });
    return await finishLogin(req, user, "sso", res);
  } catch (err) {
    await audit({
      action: "auth.sso_failed",
      status: 401,
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
      meta: { error: String(err).slice(0, 300) },
    });
    if (err instanceof SsoDenied) return fail("denied", err.message);
    console.error("[sso] callback failed:", err);
    return fail("error", "Single sign-on failed. Try again or contact your administrator.");
  }
}
