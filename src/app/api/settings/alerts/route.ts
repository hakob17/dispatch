import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { deleteSetting, getSetting, setSetting } from "@/lib/settings";

/** Integration health: notification target + the last 50 alerts (open and resolved). */
export async function GET() {
  const [url, alerts] = await Promise.all([
    getSetting<string>("alerts.webhookUrl"),
    db.systemAlert.findMany({ orderBy: { lastAt: "desc" }, take: 50 }),
  ]);
  return NextResponse.json({
    webhookUrl: url ? url.replace(/(https?:\/\/[^/]+\/).+/, "$1…") : null, // don't echo the secret path
    fromEnv: !url && !!process.env.ALERT_WEBHOOK_URL,
    alerts,
  });
}

const schema = z.object({ webhookUrl: z.string().url().startsWith("https://").nullable() });

/** Save (or clear) the Slack / Teams incoming-webhook URL; `?test=1` sends a test message. */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("test")) {
    const url = (await getSetting<string>("alerts.webhookUrl")) || process.env.ALERT_WEBHOOK_URL;
    if (!url) return NextResponse.json({ error: "no alert webhook configured" }, { status: 400 });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "✅ Dispatch: test alert — integration alerts will arrive here." }),
      signal: AbortSignal.timeout(5_000),
    }).catch((e: unknown) => ({ ok: false, status: String(e) }));
    return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: `webhook answered ${res.status}` }, { status: 502 });
  }
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "an https:// URL is required" }, { status: 400 });
  if (body.data.webhookUrl) await setSetting("alerts.webhookUrl", body.data.webhookUrl);
  else await deleteSetting("alerts.webhookUrl");
  return NextResponse.json({ ok: true });
}
