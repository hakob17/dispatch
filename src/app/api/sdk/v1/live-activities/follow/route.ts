import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { hasIdentity, resolveContact } from "@/lib/identity";
import { db } from "@/lib/db";

const schema = identitySchema.extend({
  activityKey: z.string().min(1).max(128),
  /** the device's FCM token (Android Live Updates arrive as data messages) */
  token: z.string().min(10).max(4096),
  unfollow: z.boolean().default(false),
});

/** Android: follow / unfollow a live activity on this device. */
export const POST = sdkRoute("/api/sdk/v1/live-activities/follow", schema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const contact = await resolveContact(body);
  if (!contact) return NextResponse.json({ error: "could not resolve contact" }, { status: 400 });
  if (body.unfollow) {
    await db.liveActivityToken.updateMany({ where: { kind: "FOLLOW", token: body.token, activityKey: body.activityKey }, data: { isActive: false } });
  } else {
    await db.liveActivityToken.upsert({
      where: { kind_token_activityKey: { kind: "FOLLOW", token: body.token, activityKey: body.activityKey } },
      create: { kind: "FOLLOW", token: body.token, activityKey: body.activityKey, contactId: contact.id },
      update: { isActive: true, contactId: contact.id },
    });
  }
  return NextResponse.json({ ok: true });
});

export const OPTIONS = sdkOptions;
