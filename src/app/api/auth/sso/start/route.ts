import { NextResponse } from "next/server";
import { discover, getSsoConfig, newSsoState, redirectUri, SSO_STATE_COOKIE } from "@/lib/sso";
import { getSamlConfig } from "@/lib/saml";

/** Redirect to the identity provider (authorization code + PKCE). */
export async function GET() {
  const cfg = await getSsoConfig();
  // SAML-only deployments (e.g. PingFederate over SAML): the same login button goes there
  if (!cfg && (await getSamlConfig())) return NextResponse.redirect(new URL("/api/auth/sso/saml/start", process.env.APP_BASE_URL || "http://localhost:3000"));
  if (!cfg) return NextResponse.redirect(new URL("/login?sso_error=not_configured", process.env.APP_BASE_URL || "http://localhost:3000"));
  const d = await discover(cfg.issuer);
  const { cookie, state, challenge } = newSsoState();
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    scope: "openid email profile",
    state: state.state,
    nonce: state.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set(SSO_STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax", // must survive the top-level redirect back from the IdP
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/sso",
    maxAge: 600,
  });
  return res;
}
