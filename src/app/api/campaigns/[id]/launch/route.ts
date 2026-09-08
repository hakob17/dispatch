import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/enqueue";
import { getAdapter } from "@/lib/channels";

type Params = { params: Promise<{ id: string }> };

/** POST { when?: "now" | ISO-8601 } */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const campaign = await db.campaign.findUnique({ where: { id }, include: { variants: true } });
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
    return NextResponse.json({ error: `cannot launch a ${campaign.status} campaign` }, { status: 400 });
  }
  if (!campaign.variants.length) {
    return NextResponse.json({ error: "campaign has no template variants" }, { status: 400 });
  }
  if (!(await getAdapter(campaign.channel).isConfigured())) {
    return NextResponse.json({ error: `${campaign.channel} channel is not configured` }, { status: 400 });
  }

  // Event-triggered campaigns just switch on — messages fire from /api/track
  if (campaign.trigger === "EVENT") {
    await db.campaign.update({
      where: { id },
      data: { status: "RUNNING", launchedAt: new Date(), lastRunAt: new Date() },
    });
    return NextResponse.json({ ok: true, running: true });
  }

  const runAt = body.when && body.when !== "now" ? new Date(body.when) : new Date();
  if (isNaN(runAt.getTime())) return NextResponse.json({ error: "invalid date" }, { status: 400 });

  await db.campaign.update({
    where: { id },
    data: { status: "SCHEDULED", scheduledAt: runAt },
  });
  await enqueue("LAUNCH_CAMPAIGN", { campaignId: id }, runAt);
  return NextResponse.json({ ok: true, scheduledAt: runAt.toISOString() });
}
