import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSesConfig } from "@/lib/channels/email/ses";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

// Admin-only (middleware).

const mask = (s?: string) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : null);

export async function GET() {
  const stored = await getSetting<Record<string, unknown>>("ses");
  const effective = await getSesConfig();
  return NextResponse.json({
    configured: !!effective,
    source: stored ? "settings" : effective ? "env" : null,
    form: {
      accessKeyId: mask(effective?.accessKeyId),
      secretAccessKey: effective?.secretAccessKey ? "••••••••" : null,
      region: effective?.region ?? "us-east-1",
      fromEmail: effective?.fromEmail ?? "",
      fromName: effective?.fromName ?? "",
      configurationSet: effective?.configurationSet ?? "",
      maxSendRate: effective?.maxSendRate ?? null,
    },
  });
}

const sesSchema = z.object({
  accessKeyId: z.string().min(16),
  secretAccessKey: z.string().min(16),
  region: z.string().min(2),
  fromEmail: z.string().email(),
  fromName: z.string().optional(),
  configurationSet: z.string().optional(),
  maxSendRate: z.number().positive().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const body = sesSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  await setSetting("ses", {
    ...body.data,
    fromName: body.data.fromName || undefined,
    configurationSet: body.data.configurationSet || undefined,
    maxSendRate: body.data.maxSendRate || undefined,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await deleteSetting("ses");
  return NextResponse.json({ ok: true });
}
