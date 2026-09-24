import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { audienceTokens, queueLiveEvent } from "@/lib/liveActivities";
import { liveOptionsSchema } from "@/lib/liveActivityApi";
import { filtersToWhere, type SegmentFilter } from "@/lib/segments/resolve";
import { audit } from "@/lib/audit";

const schema = liveOptionsSchema.extend({
  key: z.string().min(1).max(128).regex(/^[\w.:-]+$/, "letters, digits, . _ : - only"),
  activityType: z.string().min(1).max(128),
  attributes: z.record(z.string(), z.unknown()).default({}),
  /** Push-to-start on iOS 17.2+ now (all devices with a push-to-start token for this type, optionally narrowed by segment) */
  start: z.boolean().default(true),
  segmentId: z.string().optional(),
});

/**
 * Create a live activity (a match, an election count, a developing story) and
 * optionally start it remotely. Devices that start it report their own update
 * token through the SDK; later updates go through /<key>/update.
 */
export const POST = serverRoute("/api/v1/live-activities", schema, async ({ body, key }) => {
  const existing = await db.liveActivity.findUnique({ where: { key: body.key } });
  if (existing && existing.status === "ACTIVE") {
    return NextResponse.json({ error: `live activity "${body.key}" is already running — send updates to /${body.key}/update` }, { status: 409 });
  }
  const { key: activityKey, activityType, attributes, start, segmentId, ...options } = body;
  const data = { activityType, attributes: attributes as object, contentState: options.contentState as object, status: "ACTIVE" as const, endedAt: null };
  const activity = existing
    ? await db.liveActivity.update({ where: { id: existing.id }, data })
    : await db.liveActivity.create({ data: { key: activityKey, ...data } });

  let queued = 0;
  if (start) {
    const segment = segmentId ? await db.segment.findUnique({ where: { id: segmentId } }) : null;
    if (segmentId && !segment) return NextResponse.json({ error: "segment not found" }, { status: 404 });
    const tokens = await audienceTokens(activity, "start", segment ? filtersToWhere(segment.filters as unknown as SegmentFilter[]) : undefined);
    queued = await queueLiveEvent(activity, "start", options, tokens);
  }
  await audit({ userEmail: key ? `api-key:${key.prefix}` : null, action: "api.live_activity.start", entityType: "live-activities", entityId: activity.key });
  return NextResponse.json({ ok: true, key: activity.key, devicesQueued: queued }, { status: existing ? 200 : 201 });
});
