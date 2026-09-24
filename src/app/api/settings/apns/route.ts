import { createPrivateKey } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteSetting, getApnsConfig, getSetting, setSetting } from "@/lib/settings";

// Admin-only (proxy: /api/settings/*).

export async function GET() {
  const stored = await getSetting("apns");
  const cfg = await getApnsConfig();
  return NextResponse.json({
    configured: !!cfg,
    source: cfg ? (stored ? "settings" : "env") : null,
    keyId: cfg?.keyId ?? null,
    teamId: cfg?.teamId ?? null,
    bundleId: cfg?.bundleId ?? null,
    production: cfg?.production ?? true,
  });
}

const schema = z.object({
  keyId: z.string().length(10),
  teamId: z.string().length(10),
  bundleId: z.string().min(3),
  privateKey: z.string().includes("BEGIN PRIVATE KEY"),
  production: z.boolean().default(true),
});

/** Store the APNs token-auth key (.p8 contents + ids). */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    createPrivateKey(body.data.privateKey);
  } catch {
    return NextResponse.json({ error: "privateKey is not a valid .p8 key" }, { status: 400 });
  }
  await setSetting("apns", body.data);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await deleteSetting("apns");
  return NextResponse.json({ ok: true });
}
