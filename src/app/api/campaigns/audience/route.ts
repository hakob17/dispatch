import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { filtersToWhere, type SegmentFilter } from "@/lib/segments/resolve";
import { groupAudienceWhere } from "@/lib/subscriptions";
import { campaignPushChannels } from "@/lib/campaignFanOut";

const schema = z.object({
  channel: z.enum(["EMAIL", "FCM", "APNS", "WEB_PUSH", "IN_APP", "CONTENT_CARD", "SMS", "WHATSAPP"]),
  segmentId: z.string().nullable().optional(),
  subscriptionGroupId: z.string().nullable().optional(),
  allPushPlatforms: z.boolean().default(false),
});

/**
 * Who a campaign would reach, before sending: matching contacts, how many are
 * reachable on the channel and, for push, the device count per platform.
 * Mirrors the launch-time audience (segment ∧ newsletter subscribers ∧ reachable).
 */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { channel, segmentId, subscriptionGroupId } = body.data;
  const pushChannels = campaignPushChannels(body.data);

  const [segment, group] = await Promise.all([
    segmentId ? db.segment.findUnique({ where: { id: segmentId } }) : null,
    subscriptionGroupId ? db.subscriptionGroup.findUnique({ where: { id: subscriptionGroupId } }) : null,
  ]);
  const base: Prisma.ContactWhereInput = {
    AND: [
      segment ? filtersToWhere(segment.filters as unknown as SegmentFilter[]) : {},
      group ? groupAudienceWhere(group) : {},
    ],
  };
  const isPush = pushChannels.length > 0;
  const reach: Prisma.ContactWhereInput = isPush
    ? { subscriptions: { some: { channel: { in: pushChannels }, isActive: true } } }
    : channel === "EMAIL"
      ? { email: { not: null } }
      : channel === "SMS" || channel === "WHATSAPP"
        ? { phone: { not: null } }
        : {};

  const [matching, reachable, devices] = await Promise.all([
    db.contact.count({ where: base }),
    db.contact.count({ where: { AND: [base, reach] } }),
    isPush
      ? db.pushSubscription.groupBy({
          by: ["platform"],
          where: { channel: { in: pushChannels }, isActive: true, contact: base },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    matching,
    reachable,
    group: group ? { name: group.name, kind: group.optIn ? "newsletter" : "topic" } : null,
    devices: devices.map((d) => ({ platform: d.platform ?? "unknown", count: d._count._all })),
  });
}
