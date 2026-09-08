import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiKey } from "@/lib/apiAuth";

const tokenSchema = z.object({
  email: z.string().email(),
  token: z.string().min(10),
  platform: z.enum(["FCM", "APNS"]).default("FCM"),
});

/** Register a mobile push token (FCM/APNs) for a contact — what a mobile SDK would call. */
export async function POST(req: NextRequest) {
  const denied = await requireApiKey(req, "/api/push/register-token");
  if (denied) return denied;
  const body = tokenSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { email, token, platform } = body.data;

  const contact = await db.contact.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase() },
    update: {},
  });

  const sub = await db.pushSubscription.upsert({
    where: { channel_endpoint: { channel: platform, endpoint: token } },
    create: { contactId: contact.id, channel: platform, endpoint: token },
    update: { contactId: contact.id, isActive: true },
  });

  return NextResponse.json({ ok: true, subscriptionId: sub.id }, { status: 201 });
}
