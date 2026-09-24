import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiKey } from "@/lib/apiAuth";
import { resolveContact } from "@/lib/identity";

const subscribeSchema = z.object({
  email: z.string().email(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
});

/**
 * Attach a browser's web-push subscription to a contact (upserted by email).
 * Legacy endpoint — new integrations use the SDK's /api/sdk/v1/push/register.
 */
export async function POST(req: NextRequest) {
  const denied = await requireApiKey(req, "/api/push/subscribe");
  if (denied) return denied;
  const body = subscribeSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { email, subscription } = body.data;

  const contact = (await resolveContact({ email }))!;

  const sub = await db.pushSubscription.upsert({
    where: { channel_endpoint: { channel: "WEB_PUSH", endpoint: subscription.endpoint } },
    create: {
      contactId: contact.id,
      channel: "WEB_PUSH",
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      platform: "web",
    },
    update: { contactId: contact.id, keys: subscription.keys, isActive: true },
  });

  return NextResponse.json({ ok: true, contactId: contact.id, subscriptionId: sub.id }, { status: 201 });
}
