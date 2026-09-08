import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suppress } from "@/lib/suppression";

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

  // SNS subscription handshake
  if (sns.Type === "SubscriptionConfirmation" && typeof sns.SubscribeURL === "string") {
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
    ? await db.message.findUnique({ where: { providerMessageId } })
    : null;

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
      }
      break;
    }
  }

  return NextResponse.json({ ok: true });
}
