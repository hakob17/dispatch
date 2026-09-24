import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { hasIdentity, resolveContact } from "@/lib/identity";
import { db } from "@/lib/db";

const schema = identitySchema.extend({
  activityKey: z.string().min(1).max(128),
  /** hex push token from Activity.pushTokenUpdates */
  token: z.string().min(16).max(512),
});

/** iOS: a Live Activity started on this device (locally or by push-to-start) — register its update token. */
export const POST = sdkRoute("/api/sdk/v1/live-activities/token", schema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const contact = await resolveContact(body);
  if (!contact) return NextResponse.json({ error: "could not resolve contact" }, { status: 400 });
  await db.liveActivityToken.upsert({
    where: { kind_token_activityKey: { kind: "UPDATE", token: body.token, activityKey: body.activityKey } },
    create: { kind: "UPDATE", token: body.token, activityKey: body.activityKey, contactId: contact.id },
    update: { isActive: true, contactId: contact.id },
  });
  return NextResponse.json({ ok: true }, { status: 201 });
});

export const OPTIONS = sdkOptions;
