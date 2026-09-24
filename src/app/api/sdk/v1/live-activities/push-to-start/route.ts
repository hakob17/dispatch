import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { hasIdentity, resolveContact } from "@/lib/identity";
import { db } from "@/lib/db";

const schema = identitySchema.extend({
  /** ActivityAttributes type name, e.g. "LiveStoryAttributes" */
  activityType: z.string().min(1).max(128),
  /** hex token from Activity<T>.pushToStartTokenUpdates (iOS 17.2+) */
  token: z.string().min(16).max(512),
});

/** iOS 17.2+: lets the server start this activity type on the device remotely. */
export const POST = sdkRoute("/api/sdk/v1/live-activities/push-to-start", schema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const contact = await resolveContact(body);
  if (!contact) return NextResponse.json({ error: "could not resolve contact" }, { status: 400 });
  // activityKey is null for push-to-start rows, so the composite unique can't dedupe: do it by hand
  const existing = await db.liveActivityToken.findFirst({ where: { kind: "PUSH_TO_START", token: body.token } });
  if (existing) {
    await db.liveActivityToken.update({ where: { id: existing.id }, data: { isActive: true, contactId: contact.id, activityType: body.activityType } });
  } else {
    await db.liveActivityToken.create({ data: { kind: "PUSH_TO_START", token: body.token, activityType: body.activityType, contactId: contact.id } });
  }
  // A new push-to-start token for the same type replaces this device's older ones
  await db.liveActivityToken.updateMany({
    where: { kind: "PUSH_TO_START", contactId: contact.id, activityType: body.activityType, token: { not: body.token }, createdAt: { lt: new Date(Date.now() - 1000) } },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const OPTIONS = sdkOptions;
