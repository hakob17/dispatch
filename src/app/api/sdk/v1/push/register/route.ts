import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { hasIdentity, resolveContact } from "@/lib/identity";
import { db } from "@/lib/db";

const schema = identitySchema.extend({
  channel: z.enum(["FCM", "APNS", "WEB_PUSH"]),
  /** FCM registration token or APNs device token (hex) */
  token: z.string().min(10).max(4096).optional(),
  /** Browser PushSubscription.toJSON() for WEB_PUSH */
  subscription: z
    .object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })
    .optional(),
  platform: z.enum(["ios", "android", "web"]).optional(),
  deviceId: z.string().max(255).optional(),
  appVersion: z.string().max(64).optional(),
});

/**
 * Register (or re-home) a device's push token. A token belongs to exactly one
 * profile; a profile can hold any number of tokens across devices/platforms.
 */
export const POST = sdkRoute("/api/sdk/v1/push/register", schema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const endpoint = body.channel === "WEB_PUSH" ? body.subscription?.endpoint : body.token;
  if (!endpoint) {
    return NextResponse.json({ error: body.channel === "WEB_PUSH" ? "subscription required" : "token required" }, { status: 400 });
  }
  const contact = await resolveContact(body);
  if (!contact) return NextResponse.json({ error: "could not resolve contact" }, { status: 400 });

  const fields = {
    contactId: contact.id,
    isActive: true,
    platform: body.platform ?? (body.channel === "APNS" ? "ios" : body.channel === "WEB_PUSH" ? "web" : null),
    deviceId: body.deviceId ?? null,
    appVersion: body.appVersion ?? null,
    ...(body.subscription ? { keys: body.subscription.keys } : {}),
  };
  const sub = await db.pushSubscription.upsert({
    where: { channel_endpoint: { channel: body.channel, endpoint } },
    create: { channel: body.channel, endpoint, ...fields },
    update: fields,
  });
  // A reinstalled app gets a new token for the same device — retire the old one
  if (body.deviceId) {
    await db.pushSubscription.updateMany({
      where: { deviceId: body.deviceId, channel: body.channel, id: { not: sub.id }, isActive: true },
      data: { isActive: false },
    });
  }
  return NextResponse.json({ ok: true, subscriptionId: sub.id, contactId: contact.id }, { status: 201 });
});

export const OPTIONS = sdkOptions;
