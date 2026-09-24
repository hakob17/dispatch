import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTwilioConfig, normalizePhone, validTwilioSignature } from "@/lib/channels/sms/twilio";
import { recordEngagement } from "@/lib/tracking/record";
import { suppress, unsuppress } from "@/lib/suppression";
import { emitEvents, makeEvent, messageEventData } from "@/lib/webhooks/events";

/** Carrier opt-out keywords (Twilio's defaults) and opt-back-in keywords. */
const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START = new Set(["START", "UNSTOP", "YES", "OPTIN"]);

const twiml = () => new NextResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", { headers: { "Content-Type": "text/xml" } });

/**
 * Twilio calls this for (a) message status callbacks and (b) inbound messages — set it as the
 * Messaging Service / number's incoming-message webhook. Every request must carry a valid
 * X-Twilio-Signature for our auth token.
 */
export async function POST(req: NextRequest) {
  const cfg = await getTwilioConfig();
  if (!cfg) return NextResponse.json({ error: "Twilio not configured" }, { status: 404 });
  const params = Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  // Twilio signs the public URL it called (behind a load balancer, not the internal one)
  const publicUrl = `${(process.env.APP_BASE_URL || req.nextUrl.origin).replace(/\/+$/, "")}${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (!validTwilioSignature(cfg.authToken, publicUrl, params, req.headers.get("x-twilio-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  const status = params.MessageStatus ?? params.SmsStatus;
  // (a) Status callback for a message we sent
  if (params.MessageSid && status && !params.Body) {
    const msg = await db.message.findUnique({ where: { providerMessageId: params.MessageSid }, include: { contact: { select: { externalId: true, phone: true } } } });
    if (!msg) return twiml();
    if (status === "delivered") await recordEngagement(msg.id, "DELIVERY", { source: "twilio" });
    else if (status === "read") await recordEngagement(msg.id, "OPEN", { source: "twilio" }); // WhatsApp read receipt
    else if (status === "failed" || status === "undelivered") {
      const error = `Twilio ${params.ErrorCode ?? ""} ${status}`.trim();
      await db.message.update({ where: { id: msg.id }, data: { status: "FAILED", error } });
      await emitEvents([makeEvent("message.failed", messageEventData({ ...msg, externalId: msg.contact.externalId, error }))]);
      // 21610: the recipient had already replied STOP — record it so we stop trying
      const phone = normalizePhone(msg.contact.phone);
      if (params.ErrorCode === "21610" && phone) await suppress(msg.channel, phone, "STOP");
    }
    return twiml();
  }

  // (b) Inbound message: honour opt-out / opt-in keywords
  const whatsapp = (params.From ?? "").startsWith("whatsapp:");
  const phone = normalizePhone((params.From ?? "").replace(/^whatsapp:/, ""));
  const word = (params.Body ?? "").trim().toUpperCase();
  if (phone) {
    const channel = whatsapp ? "WHATSAPP" : "SMS";
    if (STOP.has(word)) await suppress(channel, phone, "STOP");
    else if (START.has(word)) await unsuppress(channel, phone);
  }
  return twiml();
}
