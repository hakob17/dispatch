import Bottleneck from "bottleneck";
import { db } from "@/lib/db";
import { getAdapter } from "@/lib/channels";
import { renderMessage } from "@/lib/channels/render";
import { getMaxSendRate } from "@/lib/channels/email/ses";
import { isSuppressed } from "@/lib/suppression";
import { exceedsFrequencyCap, getDeliveryRules, isUnsubscribedFromGroup, quietHoursEndsAt } from "@/lib/deliveryRules";

let sesLimiter: Bottleneck | null = null;

async function getSesLimiter(): Promise<Bottleneck> {
  if (!sesLimiter) {
    const rate = await getMaxSendRate();
    sesLimiter = new Bottleneck({ minTime: Math.ceil(1000 / rate), maxConcurrent: 1 });
    console.log(`[worker] SES rate limit: ${rate} msg/s`);
  }
  return sesLimiter;
}

/** Thrown to signal the job layer to retry with backoff. */
export class TransientSendError extends Error {}

/** Thrown to push the job to a specific later time without burning an attempt (quiet hours). */
export class RescheduleError extends Error {
  constructor(public runAt: Date, reason: string) {
    super(reason);
  }
}

export async function handleSendMessage(payload: { messageId: string }): Promise<void> {
  const message = await db.message.findUnique({
    where: { id: payload.messageId },
    include: {
      contact: true,
      pushSubscription: true,
      campaign: { select: { subscriptionGroupId: true } },
      variant: { include: { template: true } },
      journeyStep: { include: { template: true } },
    },
  });
  if (!message) return; // deleted — nothing to do
  // Status guard: makes retries/reaper idempotent (never double-send)
  if (message.status !== "QUEUED" && message.status !== "SENDING") return;

  const template = message.variant?.template ?? message.journeyStep?.template;
  if (!template) {
    await db.message.update({ where: { id: message.id }, data: { status: "FAILED", error: "no template" } });
    return;
  }

  // Suppression check immediately before send (deliverability requirement)
  if (message.channel === "EMAIL") {
    const addr = message.contact.email;
    if (!addr || (await isSuppressed("EMAIL", addr))) {
      await db.message.update({ where: { id: message.id }, data: { status: "SUPPRESSED" } });
      return;
    }
  }

  // Subscription-group opt-out
  if (await isUnsubscribedFromGroup(message.campaign?.subscriptionGroupId, message.contactId)) {
    await db.message.update({
      where: { id: message.id },
      data: { status: "SUPPRESSED", error: "unsubscribed from group" },
    });
    return;
  }

  // Delivery rules apply to campaign/journey sends, not one-off tests
  const isTest = !message.campaignId && !message.journeyStepId;
  if (!isTest && message.channel !== "WEBHOOK") {
    const rules = await getDeliveryRules();
    const quietUntil = quietHoursEndsAt(rules);
    if (quietUntil) throw new RescheduleError(quietUntil, "quiet hours");
    if (await exceedsFrequencyCap(rules, message.contactId)) {
      await db.message.update({
        where: { id: message.id },
        data: { status: "SUPPRESSED", error: "frequency cap" },
      });
      return;
    }
  }

  await db.message.update({
    where: { id: message.id },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });

  const rendered = await renderMessage({
    template,
    contact: message.contact,
    messageId: message.id,
    subscription: message.pushSubscription,
  });

  const adapter = getAdapter(message.channel);
  const doSend = () => adapter.send(rendered);
  const result = message.channel === "EMAIL" ? await (await getSesLimiter()).schedule(doSend) : await doSend();

  if (result.ok) {
    await db.message.update({
      where: { id: message.id },
      data: {
        status: result.delivered ? "DELIVERED" : "SENT",
        providerMessageId: result.providerMessageId,
        sentAt: new Date(),
        ...(result.delivered ? { deliveredAt: new Date() } : {}),
      },
    });
    if (message.pushSubscriptionId) {
      await db.pushSubscription.update({
        where: { id: message.pushSubscriptionId },
        data: { lastUsedAt: new Date() },
      });
    }
    return;
  }

  if (result.deactivateSubscription && message.pushSubscriptionId) {
    await db.pushSubscription.update({
      where: { id: message.pushSubscriptionId },
      data: { isActive: false },
    });
  }

  if (result.permanent) {
    await db.message.update({
      where: { id: message.id },
      data: { status: "FAILED", error: result.error },
    });
    return;
  }

  // Transient: put message back to QUEUED and let the job layer reschedule
  await db.message.update({
    where: { id: message.id },
    data: { status: "QUEUED", error: result.error },
  });
  throw new TransientSendError(result.error);
}
