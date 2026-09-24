import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { inboxOwner } from "@/lib/inbox";
import { recordEngagement } from "@/lib/tracking/record";
import type { CardContent } from "@/lib/channels/types";

const schema = identitySchema.extend({
  category: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * The reader's content-card feed: unexpired, undismissed cards — pinned first, then newest.
 * `viewed` / `clicked` let the app draw unread dots. Fetching counts as delivery.
 */
export const GET = sdkRoute("/api/sdk/v1/cards", schema, async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const now = new Date();
  const rows = await db.message.findMany({
    where: {
      contactId: owner.contact.id,
      channel: "CONTENT_CARD",
      status: { in: ["SENT", "DELIVERED"] },
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(body.category ? { content: { path: ["category"], equals: body.category } } : {}),
    },
    orderBy: { sentAt: "desc" },
    take: body.limit,
    select: { id: true, content: true, sentAt: true, openedAt: true, clickedAt: true, expiresAt: true, status: true, campaignId: true },
  });
  for (const r of rows) if (r.status === "SENT") void recordEngagement(r.id, "DELIVERY", { source: "cards" }).catch(() => {});
  const cards = rows
    .map((r) => ({
      id: r.id,
      ...(r.content as unknown as CardContent),
      campaignId: r.campaignId,
      sentAt: r.sentAt,
      expiresAt: r.expiresAt,
      viewed: !!r.openedAt,
      clicked: !!r.clickedAt,
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned)); // stable: newest first within each group
  return NextResponse.json({ unviewed: cards.filter((c) => !c.viewed).length, cards });
});

export const OPTIONS = sdkOptions;
