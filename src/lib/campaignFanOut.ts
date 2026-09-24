import { Channel, Prisma, type Campaign, type CampaignVariant } from "@prisma/client";
import { db } from "./db";
import { enqueueMany } from "./queue/enqueue";
import { sendTimes } from "./sendTime";

const PUSH_CHANNELS: Channel[] = ["WEB_PUSH", "FCM", "APNS"];

/**
 * Device channels a campaign sends on: every push platform for an
 * "all phones" campaign, otherwise just its channel ([] for email / in-app).
 */
export function campaignPushChannels(campaign: Pick<Campaign, "channel" | "allPushPlatforms">): Channel[] {
  if (!PUSH_CHANNELS.includes(campaign.channel)) return [];
  return campaign.allPushPlatforms ? PUSH_CHANNELS : [campaign.channel];
}

/** Weighted-random variant pick for A/B tests. */
export function pickVariant<T extends { weight: number }>(variants: T[]): T {
  const total = variants.reduce((s, v) => s + v.weight, 0) || 1;
  let r = Math.random() * total;
  for (const v of variants) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return variants[variants.length - 1];
}

export interface FanOutContact {
  id: string;
  email: string | null;
  subscriptions?: { id: string; channel?: Channel }[];
}

/**
 * Create a campaign's Message rows for a page of contacts (A/B variant,
 * control-group holdout, one message per active device for push) and queue
 * SEND_BATCH jobs — 500 per job for push (FCM sendEach limit), 100 for email
 * so the SES rate limiter spreads evenly across concurrent jobs.
 * Returns the number of messages queued for sending.
 */
export async function fanOut(
  campaign: Campaign & { variants: CampaignVariant[] },
  contacts: FanOutContact[],
  suppressedEmails: Set<string>,
  extra: { contentItemId?: string | null } = {}
): Promise<number> {
  const isPush = PUSH_CHANNELS.includes(campaign.channel);
  // Push and in-app: 500 per job. Email: 100 so the SES limiter spreads evenly.
  const batchSize = campaign.channel === "EMAIL" ? 100 : 500;
  const rows: Prisma.MessageCreateManyInput[] = [];
  for (const c of contacts) {
    const variant = pickVariant(campaign.variants);
    const isSuppressedEmail =
      campaign.channel === "EMAIL" && c.email && suppressedEmails.has(c.email.toLowerCase());
    // Control group: hold out a random slice — a Message row marks membership
    // (never sent) so lift can be measured against it.
    if (campaign.controlGroupPct > 0 && Math.random() * 100 < campaign.controlGroupPct) {
      rows.push({
        campaignId: campaign.id,
        variantId: variant.id,
        contactId: c.id,
        channel: campaign.channel,
        status: "HELD_OUT",
      });
      continue;
    }
    if (isPush) {
      // Every active device on the profile gets the message
      for (const sub of c.subscriptions ?? []) {
        rows.push({
          campaignId: campaign.id,
          variantId: variant.id,
          contactId: c.id,
          pushSubscriptionId: sub.id,
          channel: sub.channel ?? campaign.channel, // all-platform campaigns: the device decides the provider
          status: "QUEUED",
        });
      }
    } else {
      rows.push({
        campaignId: campaign.id,
        variantId: variant.id,
        contactId: c.id,
        channel: campaign.channel,
        status: isSuppressedEmail ? "SUPPRESSED" : "QUEUED",
      });
    }
  }

  if (extra.contentItemId) for (const r of rows) r.contentItemId = extra.contentItemId;

  // Create messages, then batch jobs for the queued ones
  const t0 = Date.now();
  // One transaction per page: a crash leaves whole pages or nothing, which is
  // what makes the launch handler's resume-after-last-contact point exact.
  const created = rows.length
    ? await db.$transaction(
        async (tx) => {
          const out: { id: string; status: string; contactId: string }[] = [];
          for (let i = 0; i < rows.length; i += 5000) {
            out.push(...(await tx.message.createManyAndReturn({ data: rows.slice(i, i + 5000), select: { id: true, status: true, contactId: true } })));
          }
          return out;
        },
        { timeout: 60_000 }
      )
    : [];
  const queuedRows = created.filter((m) => m.status === "QUEUED");
  const queued = queuedRows.map((m) => m.id);
  const jobs: { type: "SEND_BATCH"; payload: { messageIds: string[] }; runAt?: Date }[] = [];
  if (campaign.sendTimeOptimization && !campaign.bypassDeliveryRules) {
    // Each reader at their own best hour: one set of batches per send time
    const times = await sendTimes([...new Set(queuedRows.map((m) => m.contactId))]);
    const byTime = new Map<number, string[]>();
    for (const m of queuedRows) {
      const t = times.get(m.contactId)!.getTime();
      byTime.set(t, [...(byTime.get(t) ?? []), m.id]);
    }
    for (const [t, ids] of byTime) {
      for (let i = 0; i < ids.length; i += batchSize) {
        jobs.push({ type: "SEND_BATCH", payload: { messageIds: ids.slice(i, i + batchSize) }, runAt: new Date(t) });
      }
    }
  } else {
    for (let i = 0; i < queued.length; i += batchSize) {
      jobs.push({ type: "SEND_BATCH", payload: { messageIds: queued.slice(i, i + batchSize) } });
    }
  }
  const t1 = Date.now();
  if (jobs.length) await enqueueMany(jobs);
  if (process.env.LAUNCH_TIMING) console.log(`[fanout] insert ${t1 - t0}ms, enqueue ${Date.now() - t1}ms`);
  return queued.length;
}
