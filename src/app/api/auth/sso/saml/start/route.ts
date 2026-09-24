import { NextResponse } from "next/server";
import { getSamlConfig, samlClient } from "@/lib/saml";

const base = () => process.env.APP_BASE_URL || "http://localhost:3000";

/** SP-initiated sign-in: redirect to the IdP with a signed-for AuthnRequest id we'll expect back. */
export async function GET() {
  const cfg = await getSamlConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login?sso_error=not_configured", base()));
  const url = await samlClient(cfg).getAuthorizeUrlAsync("", undefined, {});
  return NextResponse.redirect(url);
}
