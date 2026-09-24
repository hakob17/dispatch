import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueMany } from "@/lib/queue/enqueue";
import { filtersToWhere, SegmentFilter } from "@/lib/segments/resolve";
import { groupAudienceWhere } from "@/lib/subscriptions";
import { campaignPushChannels, fanOut } from "@/lib/campaignFanOut";


interface PartitionPayload {
  campaignId: string;
  runStartedAt: string;
  /** feed auto-send: the article this run is about (its own run; repeats allowed) */
  contentItemId?: string | null;
  /** exclusive lower / inclusive upper contact-id bounds; null = open */
  after: string | null;
  upTo: string | null;
}

/**
 * Launch = split the audience into contact-id ranges and fan each range out
 * as its own LAUNCH_PARTITION job, so several workers create messages in
 * parallel (a 1M-device broadcast is otherwise bound by one worker's insert
 * rate). LAUNCH_PARTITIONS sets the split (default 8; 1 = serial).
 */
export async function handleLaunchCampaign(payload: { campaignId: string; contentItemId?: string }): Promise<void> {
  const campaign = await db.campaign.findUnique({ where: { id: payload.campaignId }, include: { variants: true } });
  if (!campaign) return;
  if (campaign.status === "CANCELED") return;
  if (!campaign.variants.length) {
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "FAILED" } });
    return;
  }

  // RUNNING = crash-resume of the current run (keep its start time);
  // anything else = a fresh run starts now. A feed auto-send (one run per
  // article) is always fresh: several articles may be going out at once.
  const itemRun = !!payload.contentItemId;
  const resuming = !itemRun && campaign.status === "RUNNING" && !!campaign.lastRunAt;
  const runStartedAt = resuming ? campaign.lastRunAt! : new Date();
  await db.campaign.update({
    where: { id: campaign.id },
    data: { status: "RUNNING", launchedAt: campaign.launchedAt ?? new Date(), lastRunAt: runStartedAt },
  });

  if (resuming || itemRun) {
    // Partitions already queued resume themselves; enqueueing again would double-send
    const live = await db.job.count({
      where: {
        type: "LAUNCH_PARTITION",
        status: { in: ["PENDING", "RUNNING"] },
        AND: [
          { payload: { path: ["campaignId"], equals: campaign.id } },
          ...(itemRun ? [{ payload: { path: ["contentItemId"], equals: payload.contentItemId! } }] : []),
        ],
      },
    });
    if (live) return;
  }

  const parts = Math.max(1, Number(process.env.LAUNCH_PARTITIONS) || 8);
  const bounds = parts > 1 ? await idBoundaries(parts) : [];
  const edges = [null, ...bounds, null];
  const partitions: PartitionPayload[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    partitions.push({
      campaignId: campaign.id,
      runStartedAt: runStartedAt.toISOString(),
      contentItemId: payload.contentItemId ?? null,
      after: edges[i],
      upTo: edges[i + 1],
    });
  }
  await enqueueMany(partitions.map((p) => ({ type: "LAUNCH_PARTITION" as const, payload: p as unknown as Record<string, unknown> })));
  console.log(`[worker] campaign ${campaign.id} launching in ${partitions.length} partition(s)`);
}

/** k−1 contact ids splitting the contact table into k equal ranges (ids are opaque but ordered). */
async function idBoundaries(k: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT max(id) AS id FROM (SELECT id, ntile(${k}::int) OVER (ORDER BY id) AS t FROM "Contact") x
    GROUP BY t ORDER BY 1`;
  return rows.slice(0, -1).map((r) => r.id);
}

export async function handleLaunchPartition(p: PartitionPayload): Promise<void> {
  const campaign = await db.campaign.findUnique({
    where: { id: p.campaignId },
    include: { segment: true, variants: true, subscriptionGroup: { select: { id: true, optIn: true } } },
  });
  if (!campaign || campaign.status === "CANCELED") return;
  const runStartedAt = new Date(p.runStartedAt);

  const segmentWhere = campaign.segment ? filtersToWhere(campaign.segment.filters as unknown as SegmentFilter[]) : {};
  const pushChannels = campaignPushChannels(campaign);
  const isPush = pushChannels.length > 0;
  const range: Prisma.ContactWhereInput = {
    id: { ...(p.after ? { gt: p.after } : {}), ...(p.upTo ? { lte: p.upTo } : {}) },
  };

  // Reachability on the channel. Deliberately no "not yet messaged" subquery
  // here: re-checking the growing Message table on every page made each page
  // slower than the last (seconds per page at scale). Instead:
  //  - within a run, keyset paging by id never revisits a contact;
  //  - crash-resume starts after the highest contact messaged in this run and
  //    range (pages are inserted atomically, in id order);
  //  - one-shot campaigns skip contacts messaged in an earlier run (e.g. an
  //    API send to specific recipients before this broadcast) via a preloaded set.
  const where: Prisma.ContactWhereInput = {
    AND: [
      segmentWhere,
      range,
      // Newsletters only reach subscribers. Topic opt-outs stay in the audience
      // and are recorded as SUPPRESSED at send time, so reports show them.
      campaign.subscriptionGroup?.optIn ? groupAudienceWhere(campaign.subscriptionGroup) : {},
      isPush
        ? { subscriptions: { some: { channel: { in: pushChannels }, isActive: true } } }
        : campaign.channel === "EMAIL"
          ? { email: { not: null } }
          : campaign.channel === "SMS" || campaign.channel === "WHATSAPP"
            ? { phone: { not: null } }
            : {},
    ],
  };

  const last = await db.message.findFirst({
    where: { campaignId: campaign.id, createdAt: { gte: runStartedAt }, contact: range, ...(p.contentItemId ? { contentItemId: p.contentItemId } : {}) },
    orderBy: { contactId: "desc" },
    select: { contactId: true },
  });
  let cursor: string | undefined = last?.contactId;
  if (cursor) console.log(`[worker] campaign ${campaign.id} partition resuming after contact ${cursor}`);

  const alreadyMessaged =
    campaign.recurrence === "NONE" && !p.contentItemId
      ? new Set(
          (
            await db.message.findMany({
              where: { campaignId: campaign.id, createdAt: { lt: runStartedAt }, contact: range },
              select: { contactId: true },
              distinct: ["contactId"],
            })
          ).map((m) => m.contactId)
        )
      : new Set<string>();

  const suppressed = new Set(
    campaign.channel === "EMAIL"
      ? (await db.suppression.findMany({ where: { channel: "EMAIL" }, select: { address: true } })).map((s) => s.address)
      : []
  );

  const pageSize = Number(process.env.LAUNCH_PAGE_SIZE) || 5000;
  let total = 0;
  for (;;) {
    const tq = Date.now();
    const contacts = await db.contact.findMany({
      // Keyset paging (id > last), not Prisma cursor+skip: skip:1 silently drops a
      // real recipient whenever the cursor row no longer matches the filter.
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      select: { id: true, email: true, subscriptions: isPush ? { where: { channel: { in: pushChannels }, isActive: true }, select: { id: true, channel: true } } : false },
      orderBy: { id: "asc" },
      take: pageSize,
    });
    if (!contacts.length) break;
    cursor = contacts[contacts.length - 1].id;

    const tf = Date.now();
    const fresh = alreadyMessaged.size ? contacts.filter((c) => !alreadyMessaged.has(c.id)) : contacts;
    total += await fanOut(campaign, fresh, suppressed, { contentItemId: p.contentItemId ?? null });
    if (process.env.LAUNCH_TIMING) console.log(`[launch] page ${contacts.length}: query ${tf - tq}ms, fan-out ${Date.now() - tf}ms`);

    if (contacts.length < pageSize) break;
  }

  console.log(`[worker] campaign ${campaign.id} partition fanned out ${total} messages`);
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
      where: {
        status: { in: ["PENDING", "RUNNING"] },
        type: { in: ["LAUNCH_CAMPAIGN", "LAUNCH_PARTITION"] },
        payload: { path: ["campaignId"], equals: c.id },
      },
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
