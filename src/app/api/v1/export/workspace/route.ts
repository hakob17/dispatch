import { NextRequest, NextResponse } from "next/server";
import { authenticateApi } from "@/lib/apiAuth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * Everything that isn't a profile or an event, as one JSON document — for exit or
 * migration (RFP 6.1): segment definitions, templates (with translations), content
 * blocks, newsletters/topics, campaigns with their variants and delivery history
 * (per-status counts, open/click totals, run timestamps), journeys and steps,
 * content feeds, webhook endpoints (secrets redacted) and the suppression list.
 *
 * Profiles + device tokens: GET /api/v1/export/contacts. Raw events and every message:
 * POST /api/v1/exports (S3).
 */
export async function GET(req: NextRequest) {
  const auth = await authenticateApi(req, "/api/v1/export/workspace", { scopes: ["SERVER"], openWhenNoKeys: false });
  if (!auth.ok) return auth.response;
  await audit({ userEmail: auth.key ? `api-key:${auth.key.prefix}` : null, action: "api.export.workspace" });

  const [segments, templates, contentBlocks, groups, campaigns, statusCounts, engagement, journeys, feeds, webhooks, suppressions] =
    await Promise.all([
      db.segment.findMany({ orderBy: { createdAt: "asc" } }),
      db.messageTemplate.findMany({ orderBy: { createdAt: "asc" } }),
      db.contentBlock.findMany(),
      db.subscriptionGroup.findMany({ orderBy: { createdAt: "asc" } }),
      db.campaign.findMany({ orderBy: { createdAt: "asc" }, include: { variants: true } }),
      db.message.groupBy({ by: ["campaignId", "status"], where: { campaignId: { not: null } }, _count: { _all: true } }),
      db.message.groupBy({
        by: ["campaignId"],
        where: { campaignId: { not: null } },
        _count: { openedAt: true, clickedAt: true, deliveredAt: true },
        _min: { sentAt: true },
        _max: { sentAt: true },
      }),
      db.journey.findMany({ orderBy: { createdAt: "asc" }, include: { steps: { orderBy: { order: "asc" } } } }),
      db.contentFeed.findMany(),
      db.webhookEndpoint.findMany(),
      db.suppression.findMany({ orderBy: { createdAt: "asc" } }),
    ]);

  const history = (id: string) => {
    const e = engagement.find((x) => x.campaignId === id);
    return {
      byStatus: Object.fromEntries(statusCounts.filter((s) => s.campaignId === id).map((s) => [s.status, s._count._all])),
      delivered: e?._count.deliveredAt ?? 0,
      opened: e?._count.openedAt ?? 0,
      clicked: e?._count.clickedAt ?? 0,
      firstSentAt: e?._min.sentAt ?? null,
      lastSentAt: e?._max.sentAt ?? null,
    };
  };

  const body = {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    segments,
    templates,
    contentBlocks,
    subscriptionGroups: groups.map((g) => ({ ...g, kind: g.optIn ? "newsletter" : "topic" })),
    campaigns: campaigns.map((c) => ({ ...c, history: history(c.id) })),
    journeys,
    contentFeeds: feeds,
    webhookEndpoints: webhooks.map((w) => ({ ...w, secret: "[redacted]" })),
    suppressions,
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      ...auth.headers,
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="workspace-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
