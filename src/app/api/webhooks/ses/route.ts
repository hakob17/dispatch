import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suppress } from "@/lib/suppression";
import { isSnsUrl, verifySnsMessage, type SnsMessage } from "@/lib/snsVerify";
import { emitEvents, makeEvent, messageEventData } from "@/lib/webhooks/events";

/**
 * SNS endpoint for SES event notifications (Bounce / Complaint / Delivery).
 * NOTE: SNS posts with Content-Type text/plain — parse the raw body.
 */
export async function POST(req: NextRequest) {
  let sns: Record<string, unknown>;
  try {
    sns = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const verified = await verifySnsMessage(sns as unknown as SnsMessage);
  if (!verified.ok) {
    console.warn(`[ses-webhook] rejected: ${verified.reason}`);
    return NextResponse.json({ error: "invalid SNS signature" }, { status: 403 });
  }

  // SNS subscription handshake
  if (sns.Type === "SubscriptionConfirmation" && typeof sns.SubscribeURL === "string") {
    if (!isSnsUrl(sns.SubscribeURL)) return NextResponse.json({ error: "bad SubscribeURL" }, { status: 400 });
    await fetch(sns.SubscribeURL);
    console.log("[ses-webhook] SNS subscription confirmed");
    return NextResponse.json({ ok: true });
  }

  if (sns.Type !== "Notification" || typeof sns.Message !== "string") {
    return NextResponse.json({ ok: true });
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(sns.Message);
  } catch {
    return NextResponse.json({ ok: true });
  }

  // SES event publishing format: { eventType, mail: { messageId }, bounce?, complaint?, delivery? }
  const eventType = (event.eventType || event.notificationType) as string | undefined;
  const mail = event.mail as { messageId?: string } | undefined;
  const providerMessageId = mail?.messageId;
  const message = providerMessageId
    ? await db.message.findUnique({ where: { providerMessageId }, include: { contact: { select: { externalId: true } } } })
    : null;
  const data = message ? messageEventData({ ...message, externalId: message.contact.externalId }) : null;

  switch (eventType) {
    case "Bounce": {
      const bounce = event.bounce as {
        bounceType?: string;
        bouncedRecipients?: { emailAddress: string }[];
      };
      const permanent = bounce?.bounceType === "Permanent";
      for (const r of bounce?.bouncedRecipients ?? []) {
        if (permanent) await suppress("EMAIL", r.emailAddress, "BOUNCE");
      }
      if (message) {
        await db.message.update({ where: { id: message.id }, data: { status: "BOUNCED" } });
        await db.messageEvent.create({
          data: { messageId: message.id, type: "BOUNCE", meta: { bounceType: bounce?.bounceType } },
        });
        await emitEvents([makeEvent("message.bounced", { ...data, bounceType: bounce?.bounceType })]);
      }
      break;
    }
    case "Complaint": {
      const complaint = event.complaint as { complainedRecipients?: { emailAddress: string }[] };
      for (const r of complaint?.complainedRecipients ?? []) {
        await suppress("EMAIL", r.emailAddress, "COMPLAINT");
      }
      if (message) {
        await db.messageEvent.create({ data: { messageId: message.id, type: "COMPLAINT" } });
      }
      break;
    }
    case "Delivery": {
      if (message) {
        await db.message.update({
          where: { id: message.id },
          data: { status: "DELIVERED", deliveredAt: new Date() },
        });
        await db.messageEvent.create({ data: { messageId: message.id, type: "DELIVERY" } });
        await emitEvents([makeEvent("message.delivered", data!)]);
      }
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
