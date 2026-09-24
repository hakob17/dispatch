import { NextResponse } from "next/server";
import { getSsoConfig } from "@/lib/sso";
import { getSamlConfig } from "@/lib/saml";
import { getSecuritySettings } from "@/lib/loginFlow";

/** Public: tells the login page whether to show the SSO button. */
export async function GET() {
  const [oidc, saml, security] = await Promise.all([getSsoConfig(), getSamlConfig(), getSecuritySettings()]);
  const cfg = oidc ?? saml;
  return NextResponse.json({ enabled: !!cfg, label: cfg?.buttonLabel ?? null, enforced: !!cfg && security.enforceSso, protocol: oidc ? "oidc" : saml ? "saml" : null });
}
