import { Channel, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueMany } from "@/lib/queue/enqueue";
import { filtersToWhere, SegmentFilter } from "@/lib/segments/resolve";

/** Weighted-random variant pick for A/B tests. */
function pickVariant<T extends { weight: number }>(variants: T[]): T {
  const total = variants.reduce((s, v) => s + v.weight, 0) || 1;
  let r = Math.random() * total;
  for (const v of variants) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return variants[variants.length - 1];
}

const PUSH_CHANNELS: Channel[] = ["WEB_PUSH", "FCM", "APNS"];

export async function handleLaunchCampaign(payload: { campaignId: string }): Promise<void> {
  const campaign = await db.campaign.findUnique({
    where: { id: payload.campaignId },
    include: { segment: true, variants: true },
  });
  if (!campaign) return;
  if (campaign.status === "CANCELED") return;
  if (!campaign.variants.length) {
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "FAILED" } });
    return;
  }

  // RUNNING = crash-resume of the current run (keep its start time);
  // anything else = a fresh run starts now.
  const runStartedAt =
    campaign.status === "RUNNING" && campaign.lastRunAt ? campaign.lastRunAt : new Date();
  await db.campaign.update({
    where: { id: campaign.id },
    data: {
      status: "RUNNING",
      launchedAt: campaign.launchedAt ?? new Date(),
      lastRunAt: runStartedAt,
    },
  });

  const segmentWhere = campaign.segment
    ? filtersToWhere(campaign.segment.filters as unknown as SegmentFilter[])
    : {};
  const isPush = PUSH_CHANNELS.includes(campaign.channel);

  // Reachability on the channel + exclude contacts already messaged in this
  // run (crash-safe). One-shot campaigns exclude anyone ever messaged;
  // recurring campaigns only exclude contacts messaged since this run began,
  // so the next run can message them again.
  const messagedFilter: Prisma.MessageWhereInput =
    campaign.recurrence === "NONE"
      ? { campaignId: campaign.id }
      : { campaignId: campaign.id, createdAt: { gte: runStartedAt } };

  const where: Prisma.ContactWhereInput = {
    AND: [
      segmentWhere,
      isPush
        ? { subscriptions: { some: { channel: campaign.channel, isActive: true } } }
        : campaign.channel === "EMAIL"
          ? { email: { not: null } }
          : {},
      { messages: { none: messagedFilter } },
    ],
  };

  const suppressed = new Set(
    campaign.channel === "EMAIL"
      ? (await db.suppression.findMany({ where: { channel: "EMAIL" }, select: { address: true } })).map((s) => s.address)
      : []
  );

  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    const contacts = await db.contact.findMany({
      where,
      select: { id: true, email: true, subscriptions: isPush ? { where: { channel: campaign.channel, isActive: true }, select: { id: true } } : false },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!contacts.length) break;
    cursor = contacts[contacts.length - 1].id;

    const rows: Prisma.MessageCreateManyInput[] = [];
    for (const c of contacts) {
      const variant = pickVariant(campaign.variants);
      const isSuppressedEmail =
        campaign.channel === "EMAIL" && c.email && suppressed.has(c.email.toLowerCase());
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
        for (const sub of (c as { subscriptions: { id: string }[] }).subscriptions) {
          rows.push({
            campaignId: campaign.id,
            variantId: variant.id,
            contactId: c.id,
            pushSubscriptionId: sub.id,
            channel: campaign.channel,
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

    // Create messages, then jobs for the queued ones
    await db.message.createMany({ data: rows });
    const created = await db.message.findMany({
      where: { campaignId: campaign.id, status: "QUEUED", contactId: { in: contacts.map((c) => c.id) } },
      select: { id: true },
    });
    await enqueueMany(created.map((m) => ({ type: "SEND_MESSAGE", payload: { messageId: m.id } })));
    total += created.length;

    if (contacts.length < 500) break;
  }

  console.log(`[worker] campaign ${campaign.id} fanned out ${total} messages`);
}

/**
 * Called by the worker tick: settle RUNNING campaigns with no pending work.
 * One-shot → COMPLETED. Recurring → schedule the next run. EVENT-triggered
 * campaigns stay RUNNING until stopped by hand.
 */
export async function completeFinishedCampaigns(): Promise<void> {
  const running = await db.campaign.findMany({
    where: { status: "RUNNING", trigger: "SCHEDULED" },
    select: { id: true, recurrence: true, lastRunAt: true },
  });
  for (const c of running) {
    const pending = await db.message.count({
      where: { campaignId: c.id, status: { in: ["QUEUED", "SENDING"] } },
    });
    const pendingJobs = await db.job.count({
      where: { status: { in: ["PENDING", "RUNNING"] }, type: "LAUNCH_CAMPAIGN", payload: { path: ["campaignId"], equals: c.id } },
    });
    if (pending !== 0 || pendingJobs !== 0) continue;

    if (c.recurrence !== "NONE") {
      const interval = c.recurrence === "DAILY" ? 24 * 3600_000 : 7 * 24 * 3600_000;
      const base = c.lastRunAt ?? new Date();
      let next = new Date(base.getTime() + interval);
      if (next <= new Date()) next = new Date(Date.now() + interval);
      await db.campaign.update({
        where: { id: c.id },
        data: { status: "SCHEDULED", scheduledAt: next },
      });
      await enqueueMany([{ type: "LAUNCH_CAMPAIGN", payload: { campaignId: c.id }, runAt: next }]);
      console.log(`[worker] recurring campaign ${c.id} → next run ${next.toISOString()}`);
    } else {
      await db.campaign.update({
        where: { id: c.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  }
}
