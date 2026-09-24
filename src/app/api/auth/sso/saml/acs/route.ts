import { NextRequest, NextResponse } from "next/server";
import { getSamlConfig, identityFromProfile, samlClient } from "@/lib/saml";
import { provisionSsoUser, SsoDenied } from "@/lib/sso";
import { finishLogin } from "@/lib/loginFlow";
import { audit } from "@/lib/audit";
import { clientIp } from "@/lib/rateLimit";

const base = () => process.env.APP_BASE_URL || "http://localhost:3000";

function fail(reason: string, detail?: string): NextResponse {
  const url = new URL("/login", base());
  url.searchParams.set("sso_error", reason);
  if (detail) url.searchParams.set("detail", detail.slice(0, 200));
  return NextResponse.redirect(url, 303);
}

/** Assertion Consumer Service: the IdP POSTs the SAMLResponse here. */
export async function POST(req: NextRequest) {
  const cfg = await getSamlConfig();
  if (!cfg) return fail("not_configured");
  const form = await req.formData();
  const SAMLResponse = form.get("SAMLResponse");
  if (typeof SAMLResponse !== "string") return fail("error", "The identity provider sent no SAML response.");
  try {
    const { profile } = await samlClient(cfg).validatePostResponseAsync({ SAMLResponse });
    if (!profile) return fail("error", "The identity provider didn't sign you in.");
    const user = await provisionSsoUser(cfg, identityFromProfile(cfg, profile));
    // 303: turn the IdP's cross-site POST into a GET of the console
    return await finishLogin(req, user, "sso", NextResponse.redirect(new URL("/", base()), 303));
  } catch (err) {
    await audit({
      action: "auth.sso_failed",
      status: 401,
      ip: clientIp(req.headers),
      userAgent: req.headers.get("user-agent"),
      meta: { protocol: "saml", error: String(err).slice(0, 300) },
    });
    if (err instanceof SsoDenied) return fail("denied", err.message);
    console.error("[saml] ACS failed:", err);
    return fail("error", "Single sign-on failed. Try again or contact your administrator.");
  }
}
