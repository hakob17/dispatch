import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const subscribeSchema = z.object({
  email: z.string().email(),
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string(), auth: z.string() }),
  }),
});

/** Attach a browser's web-push subscription to a contact (upserted by email). */
export async function POST(req: NextRequest) {
  const body = subscribeSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { email, subscription } = body.data;

  const contact = await db.contact.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase() },
    update: {},
  });

  const sub = await db.pushSubscription.upsert({
    where: { channel_endpoint: { channel: "WEB_PUSH", endpoint: subscription.endpoint } },
    create: {
      contactId: contact.id,
      channel: "WEB_PUSH",
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    },
    update: { contactId: contact.id, keys: subscription.keys, isActive: true },
  });

  return NextResponse.json({ ok: true, contactId: contact.id, subscriptionId: sub.id }, { status: 201 });
}
