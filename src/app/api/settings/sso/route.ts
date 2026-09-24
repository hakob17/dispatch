import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";
import { discover, getSsoConfig, redirectUri, type SsoConfig } from "@/lib/sso";

// Admin-only (proxy: /api/settings/*).

export async function GET() {
  const stored = await getSetting<SsoConfig>("sso");
  const cfg = await getSsoConfig();
  return NextResponse.json({
    configured: !!cfg,
    source: cfg ? (process.env.OIDC_ISSUER ? "env" : "settings") : null,
    redirectUri: redirectUri(),
    issuer: cfg?.issuer ?? stored?.issuer ?? "",
    clientId: cfg?.clientId ?? stored?.clientId ?? "",
    hasSecret: !!cfg?.clientSecret,
    allowedDomains: cfg?.allowedDomains ?? [],
    autoProvision: cfg?.autoProvision ?? false,
    defaultRole: cfg?.defaultRole ?? "USER",
    adminGroups: cfg?.adminGroups ?? [],
    buttonLabel: cfg?.buttonLabel ?? "Sign in with SSO",
  });
}

const schema = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().optional(), // blank = keep the stored one
  allowedDomains: z.array(z.string().min(3)).default([]),
  autoProvision: z.boolean().default(false),
  defaultRole: z.enum(["USER", "ADMIN"]).default("USER"),
  adminGroups: z.array(z.string().min(1)).default([]),
  buttonLabel: z.string().min(1).max(40).default("Sign in with SSO"),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const prev = await getSetting<SsoConfig>("sso");
  const clientSecret = body.data.clientSecret || prev?.clientSecret;
  if (!clientSecret) return NextResponse.json({ error: "client secret required" }, { status: 400 });
  try {
    await discover(body.data.issuer); // fail fast on a wrong issuer URL
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
  await setSetting("sso", { ...body.data, clientSecret });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await deleteSetting("sso");
  return NextResponse.json({ ok: true });
}
