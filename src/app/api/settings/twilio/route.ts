import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";
import { getTwilioConfig, statusCallbackUrl, type TwilioConfig } from "@/lib/channels/sms/twilio";

// Admin-only (proxy: /api/settings/*).

export async function GET() {
  const cfg = await getTwilioConfig();
  return NextResponse.json({
    configured: !!cfg,
    source: cfg ? (process.env.TWILIO_ACCOUNT_SID ? "env" : "settings") : null,
    accountSid: cfg?.accountSid ?? "",
    hasToken: !!cfg?.authToken,
    messagingServiceSid: cfg?.messagingServiceSid ?? "",
    fromNumber: cfg?.fromNumber ?? "",
    whatsappFrom: cfg?.whatsappFrom ?? "",
    webhookUrl: statusCallbackUrl(),
  });
}

const schema = z.object({
  accountSid: z.string().regex(/^AC[0-9a-f]{32}$/, "an account SID starts with AC and has 34 characters"),
  authToken: z.string().optional(), // blank = keep the stored one
  messagingServiceSid: z.string().regex(/^MG[0-9a-f]{32}$/, "a Messaging Service SID starts with MG").optional().or(z.literal("")),
  fromNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, "E.164, e.g. +447700900123").optional().or(z.literal("")),
  whatsappFrom: z.string().regex(/^(whatsapp:)?\+[1-9]\d{6,14}$/, "the WhatsApp sender in E.164, e.g. +14155238886").optional().or(z.literal("")),
});

/** Saves after checking the credentials against Twilio (GET the account). */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const prev = await getSetting<TwilioConfig>("twilio");
  const authToken = body.data.authToken || prev?.authToken;
  if (!authToken) return NextResponse.json({ error: "auth token required" }, { status: 400 });
  const check = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${body.data.accountSid}.json`, {
    headers: { Authorization: `Basic ${Buffer.from(`${body.data.accountSid}:${authToken}`).toString("base64")}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!check?.ok) return NextResponse.json({ error: check ? `Twilio rejected these credentials (${check.status})` : "couldn't reach Twilio" }, { status: 400 });
  await setSetting("twilio", {
    accountSid: body.data.accountSid,
    authToken,
    messagingServiceSid: body.data.messagingServiceSid || undefined,
    fromNumber: body.data.fromNumber || undefined,
    whatsappFrom: body.data.whatsappFrom || undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await deleteSetting("twilio");
  return NextResponse.json({ ok: true });
}
