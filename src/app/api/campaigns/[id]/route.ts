import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const campaign = await db.campaign.findUnique({
    where: { id },
    include: {
      segment: { select: { id: true, name: true } },
      subscriptionGroup: { select: { id: true, name: true, optIn: true } },
      variants: { include: { template: true } },
    },
  });
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [statusCounts, opened, clicked, variantStats, failures, converted, heldOutConverted] = await Promise.all([
    db.message.groupBy({ by: ["status"], where: { campaignId: id }, _count: true }),
    db.message.count({ where: { campaignId: id, openedAt: { not: null } } }),
    db.message.count({ where: { campaignId: id, clickedAt: { not: null } } }),
    db.message.groupBy({ by: ["variantId", "status"], where: { campaignId: id }, _count: true }),
    db.message.findMany({
      where: { campaignId: id, status: { in: ["FAILED", "BOUNCED"] } },
      take: 25,
      orderBy: { createdAt: "desc" },
      include: { contact: { select: { email: true, firstName: true } } },
    }),
    db.message.count({ where: { campaignId: id, convertedAt: { not: null }, status: { not: "HELD_OUT" } } }),
    db.message.count({ where: { campaignId: id, convertedAt: { not: null }, status: "HELD_OUT" } }),
  ]);

  const variantOpens = await db.message.groupBy({
    by: ["variantId"],
    where: { campaignId: id, openedAt: { not: null } },
    _count: true,
  });
  const variantClicks = await db.message.groupBy({
    by: ["variantId"],
    where: { campaignId: id, clickedAt: { not: null } },
    _count: true,
  });

  return NextResponse.json({
    campaign,
    stats: {
      byStatus: Object.fromEntries(statusCounts.map((s) => [s.status, s._count])),
      opened,
      clicked,
      converted,
      heldOutConverted,
      byVariant: variantStats,
      variantOpens: Object.fromEntries(variantOpens.map((v) => [v.variantId ?? "", v._count])),
      variantClicks: Object.fromEntries(variantClicks.map((v) => [v.variantId ?? "", v._count])),
    },
    failures,
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (campaign.status === "RUNNING") {
    return NextResponse.json({ error: "cancel the campaign first" }, { status: 400 });
  }
  await db.campaign.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

/** PATCH { action: "cancel" | "stop" } — stop ends an event-triggered/recurring campaign gracefully. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { action } = await req.json();
  if (action === "stop") {
    await db.campaign.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }
  if (action === "cancel") {
    await db.campaign.update({ where: { id }, data: { status: "CANCELED" } });
    // Drop not-yet-sent work
    await db.message.updateMany({
      where: { campaignId: id, status: "QUEUED" },
      data: { status: "FAILED", error: "campaign canceled" },
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
