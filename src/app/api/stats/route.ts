import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const [contacts, segments, campaigns, journeys, sent, delivered, opened, clicked, suppressed, recentCampaigns, pendingJobs] =
    await Promise.all([
      db.contact.count(),
      db.segment.count(),
      db.campaign.count(),
      db.journey.count({ where: { status: "ACTIVE" } }),
      db.message.count({ where: { sentAt: { gte: since } } }),
      db.message.count({ where: { deliveredAt: { gte: since } } }),
      db.message.count({ where: { openedAt: { gte: since } } }),
      db.message.count({ where: { clickedAt: { gte: since } } }),
      db.suppression.count(),
      db.campaign.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { _count: { select: { messages: true } } },
      }),
      db.job.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    ]);
  return NextResponse.json({
    contacts, segments, campaigns, activeJourneys: journeys,
    last30d: { sent, delivered, opened, clicked },
    suppressed, recentCampaigns, pendingJobs,
  });
}
