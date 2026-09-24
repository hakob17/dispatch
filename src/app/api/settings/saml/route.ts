import { X509Certificate } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";
import { acsUrl, DEFAULT_ATTRIBUTES, getSamlConfig, normalizeCert, spEntityId, type SamlConfig } from "@/lib/saml";

// Admin-only (proxy: /api/settings/*).

function certInfo(pem: string | undefined) {
  if (!pem) return null;
  try {
    const c = new X509Certificate(normalizeCert(pem));
    return { subject: c.subject.replace(/\n/g, ", "), validTo: new Date(c.validTo).toISOString(), expired: new Date(c.validTo) < new Date() };
  } catch {
    return null;
  }
}

export async function GET() {
  const cfg = await getSamlConfig();
  const stored = await getSetting<SamlConfig>("saml");
  const c = cfg ?? stored;
  return NextResponse.json({
    configured: !!cfg,
    source: cfg ? (process.env.SAML_ENTRY_POINT ? "env" : "settings") : null,
    spEntityId: spEntityId(),
    acsUrl: acsUrl(),
    metadataUrl: spEntityId(),
    entryPoint: c?.entryPoint ?? "",
    idpIssuer: c?.idpIssuer ?? "",
    cert: certInfo(c?.idpCert),
    emailAttributes: c?.emailAttributes ?? DEFAULT_ATTRIBUTES.email,
    groupsAttributes: c?.groupsAttributes ?? DEFAULT_ATTRIBUTES.groups,
    allowedDomains: c?.allowedDomains ?? [],
    autoProvision: c?.autoProvision ?? false,
    defaultRole: c?.defaultRole ?? "USER",
    adminGroups: c?.adminGroups ?? [],
    buttonLabel: c?.buttonLabel ?? "Sign in with SSO",
  });
}

const list = z.array(z.string().min(1)).default([]);
const schema = z.object({
  entryPoint: z.string().url().startsWith("https://", "the IdP sign-in URL must be https"),
  idpIssuer: z.string().optional(),
  idpCert: z.string().optional(), // blank = keep the stored one
  emailAttributes: list,
  groupsAttributes: list,
  allowedDomains: list,
  autoProvision: z.boolean().default(false),
  defaultRole: z.enum(["USER", "ADMIN"]).default("USER"),
  adminGroups: list,
  buttonLabel: z.string().min(1).max(40).default("Sign in with SSO"),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const prev = await getSetting<SamlConfig>("saml");
  const idpCert = body.data.idpCert?.trim() || prev?.idpCert;
  if (!idpCert) return NextResponse.json({ error: "the IdP signing certificate is required" }, { status: 400 });
  const info = certInfo(idpCert);
  if (!info) return NextResponse.json({ error: "that isn't a valid X.509 certificate (paste the PEM, or its base64 body)" }, { status: 400 });
  if (info.expired) return NextResponse.json({ error: `that certificate expired on ${info.validTo.slice(0, 10)}` }, { status: 400 });
  await setSetting("saml", {
    ...body.data,
    idpCert,
    idpIssuer: body.data.idpIssuer || undefined,
    emailAttributes: body.data.emailAttributes.length ? body.data.emailAttributes : DEFAULT_ATTRIBUTES.email,
    groupsAttributes: body.data.groupsAttributes.length ? body.data.groupsAttributes : DEFAULT_ATTRIBUTES.groups,
  });
  return NextResponse.json({ ok: true, cert: info });
}

export async function DELETE() {
  await deleteSetting("saml");
  return NextResponse.json({ ok: true });
}
