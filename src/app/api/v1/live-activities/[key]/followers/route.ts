import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { keyFromPath } from "@/lib/liveActivityApi";

const schema = z.object({ externalIds: z.array(z.string().min(1)).min(1).max(1000), unfollow: z.boolean().default(false) });

/**
 * Server-side follow (Android Live Updates): the users' active FCM devices
 * start receiving this activity's updates. The SDK's follow call does the
 * same from the device.
 */
export const POST = serverRoute("/api/v1/live-activities/:key/followers", schema, async ({ req, body }) => {
  const activityKey = keyFromPath(req.nextUrl.pathname);
  const contacts = await db.contact.findMany({
    where: { externalId: { in: body.externalIds } },
    select: { id: true, subscriptions: { where: { channel: "FCM", isActive: true, NOT: { platform: "ios" } }, select: { endpoint: true } } },
  });
  let changed = 0;
  for (const c of contacts) {
    for (const s of c.subscriptions) {
      if (body.unfollow) {
        changed += (await db.liveActivityToken.updateMany({ where: { kind: "FOLLOW", activityKey, token: s.endpoint }, data: { isActive: false } })).count;
      } else {
        await db.liveActivityToken.upsert({
          where: { kind_token_activityKey: { kind: "FOLLOW", token: s.endpoint, activityKey } },
          create: { kind: "FOLLOW", token: s.endpoint, activityKey, contactId: c.id },
          update: { isActive: true, contactId: c.id },
        });
        changed++;
      }
    }
  }
  return NextResponse.json({ ok: true, matchedUsers: contacts.length, devices: changed });
});
