import { NextResponse } from "next/server";
import webpush from "web-push";
import { getVapidKeys, setSetting } from "@/lib/settings";

export async function GET() {
  const keys = await getVapidKeys();
  return NextResponse.json({
    configured: !!keys,
    publicKey: keys?.publicKey ?? null,
    source: process.env.VAPID_PUBLIC_KEY ? "env" : "settings",
  });
}

/** Generate and persist a fresh VAPID key pair. */
export async function POST() {
  if (process.env.VAPID_PUBLIC_KEY) {
    return NextResponse.json({ error: "VAPID keys are set via env vars" }, { status: 400 });
  }
  const keys = webpush.generateVAPIDKeys();
  await setSetting("vapid", keys);
  return NextResponse.json({ ok: true, publicKey: keys.publicKey });
}
