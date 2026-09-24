import Bottleneck from "bottleneck";
import { MessageStatus, Prisma, type MessageTemplate } from "@prisma/client";
import { db, durableWrite, utcTs } from "@/lib/db";
import { getAdapter } from "@/lib/channels";
import { renderMessage } from "@/lib/channels/render";
import { getMaxSendRate } from "@/lib/channels/email/ses";
import type { RenderedMessage, SendResult } from "@/lib/channels/types";
import { getDeliveryRules, quietHoursEndsAt, type DeliveryRules } from "@/lib/deliveryRules";
import { enqueueMany } from "@/lib/queue/enqueue";
import { emitEvents, makeEvent, messageEventData, type OutboundEvent } from "@/lib/webhooks/events";
import { recommendForContacts, recVars, templateRecNeeds, type RecItem } from "@/lib/recommend";
import { isSubscribed } from "@/lib/subscriptions";
import { providerBatchOutcome } from "@/lib/alerts";
import { normalizePhone } from "@/lib/channels/sms/twilio";

let sesLimiter: Bottleneck | null = null;

/**
 * SES send-rate limiter. With several worker tasks each process takes an
 * equal share of the account quota (WORKER_COUNT = number of worker tasks).
 */
async function getSesLimiter(): Promise<Bottleneck> {
  if (!sesLimiter) {
    const workers = Math.max(1, Number(process.env.WORKER_COUNT) || 1);
    const rate = Math.max(0.1, (await getMaxSendRate()) / workers);
    sesLimiter = new Bottleneck({ minTime: Math.ceil(1000 / rate), maxConcurrent: 1 });
    console.log(`[worker] SES rate limit: ${rate.toFixed(2)} msg/s (this worker's share)`);
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

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000];
const MAX_SEND_RETRIES = RETRY_DELAYS_MS.length;
const FALLBACK_CONCURRENCY = Number(process.env.SEND_CONCURRENCY) || 50;

/** Single message (event-triggered campaigns, journeys, test sends). */
export async function handleSendMessage(payload: { messageId: string; retry?: number }): Promise<void> {
  await handleSendBatch({ messageIds: [payload.messageId], retry: payload.retry });
}

type LoadedMessage = Prisma.MessageGetPayload<{
  include: {
    contact: true;
    pushSubscription: true;
    campaign: { select: { subscriptionGroupId: true; bypassDeliveryRules: true } };
    variant: { include: { template: true } };
    journeyStep: { include: { template: true } };
  };
}>;

interface StatusRow {
  id: string;
  status: MessageStatus;
  providerMessageId?: string | null;
  error?: string | null;
  sent?: boolean;
  delivered?: boolean;
  content?: unknown; // IN_APP / CONTENT_CARD rendered content
  expiresAt?: Date | null;
  contentItemId?: string | null; // article the message carried (recommendation exclusions)
}

/** One UPDATE for many rows: UPDATE … FROM (VALUES …). */
async function bulkSetStatus(rows: StatusRow[], onlyFrom?: MessageStatus): Promise<void> {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const values = Prisma.join(
      chunk.map(
        (r) =>
          Prisma.sql`(${r.id}, ${r.status}, ${r.providerMessageId ?? null}::text, ${r.error ?? null}::text, ${!!r.sent}, ${!!r.delivered},
            ${r.content === undefined ? null : JSON.stringify(r.content)}::jsonb, ${utcTs(r.expiresAt)}, ${r.contentItemId ?? null}::text)`
      )
    );
    await db.$executeRaw`
      UPDATE "Message" AS m SET
        -- A device receipt can land before this write (fast push): never downgrade DELIVERED to SENT
        status = CASE WHEN v.status = 'SENT' AND m.status = 'DELIVERED' THEN m.status ELSE v.status::"MessageStatus" END,
        "providerMessageId" = COALESCE(v.pid, m."providerMessageId"),
        error = v.err,
        "sentAt" = CASE WHEN v.sent THEN (now() AT TIME ZONE 'UTC') ELSE m."sentAt" END,
        "deliveredAt" = CASE WHEN v.delivered THEN (now() AT TIME ZONE 'UTC') ELSE m."deliveredAt" END,
        content = COALESCE(v.content, m.content),
        "expiresAt" = COALESCE(v.expires, m."expiresAt"),
        "contentItemId" = COALESCE(v.item, m."contentItemId")
      FROM (VALUES ${values}) AS v(id, status, pid, err, sent, delivered, content, expires, item)
      WHERE m.id = v.id ${onlyFrom ? Prisma.sql`AND m.status = ${onlyFrom}::"MessageStatus"` : Prisma.empty}`;
  }
}

/** Contact ids that would exceed the per-day / per-week caps with one more message. */
async function cappedContacts(rules: DeliveryRules, contactIds: string[]): Promise<Set<string>> {
  const capped = new Set<string>();
  if (!contactIds.length || (!rules.maxPerDay && !rules.maxPerWeek)) return capped;
  const windows: [number | null, number][] = [
    [rules.maxPerDay, 24 * 3600_000],
    [rules.maxPerWeek, 7 * 24 * 3600_000],
  ];
  for (const [max, ms] of windows) {
    if (!max) continue;
    const counts = await db.message.groupBy({
      by: ["contactId"],
      where: { contactId: { in: contactIds }, sentAt: { gte: new Date(Date.now() - ms) } },
      _count: { _all: true },
    });
    for (const c of counts) if (c._count._all >= max) capped.add(c.contactId);
  }
  return capped;
}

/**
 * Send a batch of messages (any channel). Steps:
 *  1. load QUEUED messages; drop group opt-outs, missing templates, suppressions
 *  2. delivery rules (quiet hours → reschedule, frequency caps → suppress),
 *     skipped for test sends and campaigns flagged bypassDeliveryRules
 *  3. atomically claim QUEUED → SENDING (a message is only ever sent once:
 *     one that was mid-send when a worker died is never retried blindly)
 *  4. provider batch send, bulk status update, dead-token cleanup
 *  5. transient failures are re-queued as a new batch with backoff
 */
export async function handleSendBatch(payload: { messageIds: string[]; retry?: number }): Promise<void> {
  const retry = payload.retry ?? 0;
  const contentItemFor = new Map<string, string>();
  const loaded: LoadedMessage[] = await db.message.findMany({
    where: { id: { in: payload.messageIds }, status: "QUEUED" },
    include: {
      contact: true,
      pushSubscription: true,
      campaign: { select: { subscriptionGroupId: true, bypassDeliveryRules: true } },
      variant: { include: { template: true } },
      journeyStep: { include: { template: true } },
    },
  });
  if (!loaded.length) return;

  const final: StatusRow[] = [];
  const events: OutboundEvent[] = [];
  const eventData = (m: LoadedMessage, error?: string) =>
    messageEventData({ ...m, externalId: m.contact.externalId, error });

  // 1. Pre-send filters
  const groupIds = [...new Set(loaded.map((m) => m.campaign?.subscriptionGroupId).filter(Boolean) as string[])];
  // Effective state per group+contact: an explicit row wins, else topics are
  // on and newsletters are off (see lib/subscriptions).
  const [groups, states] = groupIds.length
    ? await Promise.all([
        db.subscriptionGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, optIn: true } }),
        db.subscriptionState.findMany({
          where: { groupId: { in: groupIds }, contactId: { in: loaded.map((m) => m.contactId) } },
          select: { groupId: true, contactId: true, subscribed: true },
        }),
      ])
    : [[], []];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const stateByKey = new Map(states.map((s) => [`${s.groupId}:${s.contactId}`, s.subscribed]));
  const notSubscribed = (groupId: string, contactId: string) => {
    const g = groupById.get(groupId);
    return g ? !isSubscribed(g, stateByKey.get(`${groupId}:${contactId}`)) : false;
  };
  const emailSuppressed = new Set(
    (
      await db.suppression.findMany({
        where: {
          channel: "EMAIL",
          address: { in: loaded.filter((m) => m.channel === "EMAIL" && m.contact.email).map((m) => m.contact.email!.toLowerCase()) },
        },
        select: { address: true },
      })
    ).map((s) => s.address)
  );

  // SMS / WhatsApp: numbers that replied STOP (per channel)
  const textMsgs = loaded.filter((m) => (m.channel === "SMS" || m.channel === "WHATSAPP") && normalizePhone(m.contact.phone));
  const phoneSuppressed = new Set(
    textMsgs.length
      ? (
          await db.suppression.findMany({
            where: { channel: { in: ["SMS", "WHATSAPP"] }, address: { in: textMsgs.map((m) => normalizePhone(m.contact.phone)!) } },
            select: { channel: true, address: true },
          })
        ).map((s) => `${s.channel}:${s.address}`)
      : []
  );

  let candidates: LoadedMessage[] = [];
  for (const m of loaded) {
    const template = m.variant?.template ?? m.journeyStep?.template;
    if (!template) {
      final.push({ id: m.id, status: "FAILED", error: "no template" });
      continue;
    }
    if (m.campaign?.subscriptionGroupId && notSubscribed(m.campaign.subscriptionGroupId, m.contactId)) {
      final.push({ id: m.id, status: "SUPPRESSED", error: "not subscribed to group" });
      continue;
    }
    if (m.channel === "EMAIL" && (!m.contact.email || emailSuppressed.has(m.contact.email.toLowerCase()))) {
      final.push({ id: m.id, status: "SUPPRESSED" });
      continue;
    }
    if (m.channel === "SMS" || m.channel === "WHATSAPP") {
      const phone = normalizePhone(m.contact.phone);
      if (!phone) {
        final.push({ id: m.id, status: "SUPPRESSED", error: "no valid phone number" });
        continue;
      }
      if (phoneSuppressed.has(`${m.channel}:${phone}`)) {
        final.push({ id: m.id, status: "SUPPRESSED", error: "opted out (STOP)" });
        continue;
      }
    }
    candidates.push(m);
  }

  // 2. Delivery rules
  const ruled = candidates.filter(
    // In-app messages are pulled by the app, so quiet hours / caps don't apply
    (m) => (m.campaignId || m.journeyStepId) && m.channel !== "WEBHOOK" && m.channel !== "IN_APP" && m.channel !== "CONTENT_CARD" && !m.campaign?.bypassDeliveryRules
  );
  if (ruled.length) {
    const rules = await getDeliveryRules();
    const quietUntil = quietHoursEndsAt(rules);
    if (quietUntil) {
      // Push these to the end of quiet hours (no retry attempt burned)
      const ids = new Set(ruled.map((m) => m.id));
      candidates = candidates.filter((m) => !ids.has(m.id));
      await enqueueMany([{ type: "SEND_BATCH", payload: { messageIds: [...ids], retry }, runAt: quietUntil }]);
    } else {
      const capped = await cappedContacts(rules, [...new Set(ruled.map((m) => m.contactId))]);
      if (capped.size) {
        const ruledIds = new Set(ruled.map((m) => m.id));
        candidates = candidates.filter((m) => {
          if (ruledIds.has(m.id) && capped.has(m.contactId)) {
            final.push({ id: m.id, status: "SUPPRESSED", error: "frequency cap" });
            return false;
          }
          return true;
        });
      }
    }
  }

  if (final.length) {
    await bulkSetStatus(final, "QUEUED");
    for (const r of final) {
      if (r.status === "FAILED") {
        const m = loaded.find((x) => x.id === r.id)!;
        events.push(makeEvent("message.failed", eventData(m, r.error ?? undefined)));
      }
    }
  }
  if (!candidates.length) return void (await emitEvents(events));

  // 3. Atomic claim
  const claimedIds = new Set(
    (
      await db.$queryRaw<{ id: string }[]>`
        UPDATE "Message" SET status = 'SENDING', attempts = attempts + 1
        WHERE id IN (${Prisma.join(candidates.map((m) => m.id))}) AND status = 'QUEUED'
        RETURNING id`
    ).map((r) => r.id)
  );
  const toSend = candidates.filter((m) => claimedIds.has(m.id));
  if (!toSend.length) return void (await emitEvents(events));

  // 4. Render + send, grouped by channel
  const results = new Map<string, SendResult>();
  const byChannel = new Map<string, { m: LoadedMessage; r: RenderedMessage }[]>();
  const ctx = await batchContext(toSend);
  const unsendable: StatusRow[] = [];
  for (const m of toSend) {
    const template = (m.variant?.template ?? m.journeyStep?.template)!;
    const { vars, missing, itemId } = ctx(m);
    if (missing) {
      unsendable.push({ id: m.id, status: "SUPPRESSED", error: missing });
      continue;
    }
    const r = await renderMessage({ template, contact: m.contact, messageId: m.id, subscription: m.pushSubscription, extraVars: vars, channel: m.channel });
    if (itemId) contentItemFor.set(m.id, itemId);
    const list = byChannel.get(m.channel) ?? [];
    list.push({ m, r });
    byChannel.set(m.channel, list);
  }
  for (const [channel, items] of byChannel) {
    const adapter = getAdapter(items[0].m.channel);
    let res: SendResult[];
    if (adapter.sendBatch) {
      res = await adapter.sendBatch(items.map((x) => x.r));
    } else {
      const limiter = channel === "EMAIL" ? await getSesLimiter() : null;
      res = new Array(items.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(FALLBACK_CONCURRENCY, items.length) }, async () => {
          while (next < items.length) {
            const i = next++;
            const send = () => adapter.send(items[i].r);
            res[i] = limiter ? await limiter.schedule(send) : await send();
          }
        })
      );
    }
    items.forEach((x, i) => results.set(x.m.id, res[i]));
    if (channel !== "WEBHOOK" && channel !== "IN_APP" && channel !== "CONTENT_CARD") {
      // Provider health (RFP 10.3): dead tokens are the audience's problem, everything else is ours
      const failed = res.filter((r) => !r.ok && !r.deactivateSubscription);
      await providerBatchOutcome(channel, res.filter((r) => r.ok).length, failed.length, failed[0] && !failed[0].ok ? failed[0].error : undefined);
    }
  }

  // 5. Persist outcomes
  const updates: StatusRow[] = [...unsendable];
  const deadSubs: string[] = [];
  const usedSubs: string[] = [];
  const retryIds: string[] = [];
  for (const m of toSend) {
    const r = results.get(m.id);
    if (!r) continue; // suppressed before sending (e.g. no recommendation left)
    if (r.ok) {
      const template = (m.variant?.template ?? m.journeyStep?.template)!;
      updates.push({
        id: m.id,
        status: r.delivered ? "DELIVERED" : "SENT",
        providerMessageId: r.providerMessageId,
        sent: true,
        delivered: !!r.delivered,
        content: r.content,
        expiresAt: r.content ? new Date(Date.now() + (template.inAppExpiresHours ?? 24 * 30) * 3600_000) : null,
        contentItemId: contentItemFor.get(m.id) ?? null,
      });
      if (m.pushSubscriptionId) usedSubs.push(m.pushSubscriptionId);
      events.push(makeEvent("message.sent", eventData(m)));
      if (r.delivered) events.push(makeEvent("message.delivered", eventData(m)));
      continue;
    }
    if (r.deactivateSubscription && m.pushSubscriptionId) deadSubs.push(m.pushSubscriptionId);
    if (r.permanent || retry >= MAX_SEND_RETRIES) {
      updates.push({ id: m.id, status: "FAILED", error: r.error });
      events.push(makeEvent("message.failed", eventData(m, r.error)));
    } else {
      updates.push({ id: m.id, status: "QUEUED", error: r.error });
      retryIds.push(m.id);
    }
  }
  // Past this point the provider has accepted messages: every write below is
  // retried so a busy database can't leave sent messages looking unsent.
  await durableWrite(() => bulkSetStatus(updates));
  if (deadSubs.length) await durableWrite(() => db.pushSubscription.updateMany({ where: { id: { in: deadSubs } }, data: { isActive: false } }));
  if (usedSubs.length) await durableWrite(() => db.pushSubscription.updateMany({ where: { id: { in: usedSubs } }, data: { lastUsedAt: new Date() } }));
  if (retryIds.length) {
    await durableWrite(() =>
      enqueueMany([
        { type: "SEND_BATCH", payload: { messageIds: retryIds, retry: retry + 1 }, runAt: new Date(Date.now() + RETRY_DELAYS_MS[retry]) },
      ])
    );
  }
  await durableWrite(() => emitEvents(events));
}

/**
 * Per-batch personalisation context: one query for the articles messages are
 * about (feed auto-sends: {{item.*}}), one recommendation pass for everyone
 * whose template uses {{recommendation.N.*}} / {{trending.N.*}}.
 */
async function batchContext(messages: LoadedMessage[]) {
  const templateOf = (m: LoadedMessage) => (m.variant?.template ?? m.journeyStep?.template)!;
  const textsOf = (t: MessageTemplate) => [t.subject, t.htmlBody, t.textBody, t.pushTitle, t.pushBody, t.pushUrl, t.pushImageUrl, JSON.stringify(t.translations ?? "")];
  const needs = new Map(messages.map((m) => [m.id, templateRecNeeds(textsOf(templateOf(m)))]));

  const itemIds = [...new Set(messages.map((m) => m.contentItemId).filter(Boolean) as string[])];
  const items = itemIds.length ? new Map((await db.contentItem.findMany({ where: { id: { in: itemIds } } })).map((i) => [i.id, i])) : new Map();

  const recContacts = (key: "recommendation" | "trending") => {
    const seen = new Map<string, { id: string; language: string | null }>();
    for (const m of messages) if (needs.get(m.id)?.[key]) seen.set(m.contactId, { id: m.contactId, language: m.contact.language });
    return [...seen.values()];
  };
  const forYouList = recContacts("recommendation");
  const trendingList = recContacts("trending");
  const forYou = forYouList.length ? await recommendForContacts(forYouList, { strategy: "for_you" }) : new Map<string, RecItem[]>();
  const trending = trendingList.length ? await recommendForContacts(trendingList, { strategy: "trending" }) : new Map<string, RecItem[]>();

  return (m: LoadedMessage): { vars: Record<string, string>; missing?: string; itemId?: string } => {
    const need = needs.get(m.id)!;
    const vars: Record<string, string> = {};
    let itemId: string | undefined;
    if (need.item) {
      const item = m.contentItemId ? items.get(m.contentItemId) : undefined;
      if (!item) return { vars, missing: "template uses {{item.*}} but the message has no article" };
      Object.assign(vars, recVars("item", [item]));
    }
    if (need.recommendation) {
      const recs = forYou.get(m.contactId) ?? [];
      if (!recs.length) return { vars, missing: "no recommendation left for this reader" };
      Object.assign(vars, recVars("recommendation", recs));
      itemId = recs[0].id; // never recommend the same article to them again
    }
    if (need.trending) {
      const recs = trending.get(m.contactId) ?? [];
      if (!recs.length) return { vars, missing: "no trending article left for this reader" };
      Object.assign(vars, recVars("trending", recs));
      itemId ??= recs[0].id;
    }
    return { vars, itemId };
  };
}

/**
 * Messages stuck in SENDING (worker died mid-send) are marked FAILED rather
 * than retried: the provider may already have accepted them, and a duplicate
 * breaking-news alert is worse than a reported failure.
 */
export async function failInterruptedSends(): Promise<number> {
  const res = await db.message.updateMany({
    where: { status: "SENDING", sentAt: null, createdAt: { lt: new Date(Date.now() - 3600_000) } },
    data: { status: "FAILED", error: "interrupted during send (not retried to avoid duplicates)" },
  });
  return res.count;
}
