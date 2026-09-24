import { Channel, Prisma } from "@prisma/client";
import { db } from "./db";
import { enqueue } from "./queue/enqueue";
import { filtersToWhere, SegmentFilter } from "./segments/resolve";
import { emitEvents, makeEvent } from "./webhooks/events";
import { campaignPushChannels } from "./campaignFanOut";
import { journeyEventHooks } from "./journeys";

const PUSH_CHANNELS: Channel[] = ["WEB_PUSH", "FCM", "APNS"];

export interface IngestedEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string | Date;
}

/**
 * Store custom events for a contact, then fire event-triggered campaigns and
 * attribute conversions. Shared by /api/track, the SDK and the server API.
 */
export async function ingestEvents(
  contactId: string,
  events: IngestedEvent[]
): Promise<{ eventIds: string[]; triggeredCampaigns: number; conversions: number }> {
  const eventIds: string[] = [];
  let triggeredCampaigns = 0;
  let conversions = 0;
  for (const e of events) {
    const ts = e.timestamp ? new Date(e.timestamp) : null;
    const created = await db.contactEvent.create({
      data: {
        contactId,
        name: e.name,
        properties: (e.properties ?? {}) as Prisma.InputJsonObject,
        ...(ts && !isNaN(ts.getTime()) && ts.getTime() <= Date.now() ? { createdAt: ts } : {}),
      },
    });
    eventIds.push(created.id);
    const [t, c] = await Promise.all([
      fireTriggeredCampaigns(contactId, e.name),
      attributeConversions(contactId, e.name),
      journeyEventHooks(contactId, e.name), // enter / resume / exit journeys
    ]);
    triggeredCampaigns += t;
    conversions += c;
  }
  return { eventIds, triggeredCampaigns, conversions };
}

/** Fire RUNNING event-triggered campaigns matching this event (once per contact per campaign). */
export async function fireTriggeredCampaigns(contactId: string, event: string): Promise<number> {
  const campaigns = await db.campaign.findMany({
    where: { trigger: "EVENT", triggerEvent: event, status: "RUNNING" },
    include: { segment: true, variants: true },
  });
  let fired = 0;

  for (const campaign of campaigns) {
    if (!campaign.variants.length) continue;

    // once per contact per campaign
    const already = await db.message.count({ where: { campaignId: campaign.id, contactId } });
    if (already > 0) continue;

    // segment gate
    if (campaign.segment) {
      const where = filtersToWhere(campaign.segment.filters as unknown as SegmentFilter[]);
      const matches = await db.contact.count({ where: { AND: [{ id: contactId }, where] } });
      if (!matches) continue;
    }

    const variant =
      campaign.variants[Math.floor(Math.random() * campaign.variants.length)] ?? campaign.variants[0];

    if (campaign.controlGroupPct > 0 && Math.random() * 100 < campaign.controlGroupPct) {
      await db.message.create({
        data: { campaignId: campaign.id, variantId: variant.id, contactId, channel: campaign.channel, status: "HELD_OUT" },
      });
      continue;
    }

    if (PUSH_CHANNELS.includes(campaign.channel)) {
      const subs = await db.pushSubscription.findMany({
        where: { contactId, channel: { in: campaignPushChannels(campaign) }, isActive: true },
        select: { id: true, channel: true },
      });
      for (const sub of subs) {
        const msg = await db.message.create({
          data: { campaignId: campaign.id, variantId: variant.id, contactId, pushSubscriptionId: sub.id, channel: sub.channel, status: "QUEUED" },
        });
        await enqueue("SEND_MESSAGE", { messageId: msg.id });
        fired++;
      }
    } else {
      const contact = await db.contact.findUnique({ where: { id: contactId }, select: { email: true } });
      if (campaign.channel === "EMAIL" && !contact?.email) continue;
      const msg = await db.message.create({
        data: { campaignId: campaign.id, variantId: variant.id, contactId, channel: campaign.channel, status: "QUEUED" },
      });
      await enqueue("SEND_MESSAGE", { messageId: msg.id });
      fired++;
    }
  }
  return fired;
}

/** Mark in-window campaign messages (sent or held-out) as converted by this event. */
export async function attributeConversions(contactId: string, event: string): Promise<number> {
  const campaigns = await db.campaign.findMany({
    where: { conversionEvent: event, launchedAt: { not: null } },
    select: { id: true, conversionWindowHours: true, launchedAt: true },
  });
  let converted = 0;
  const now = new Date();

  for (const campaign of campaigns) {
    const windowMs = campaign.conversionWindowHours * 3600_000;
    const messages = await db.message.findMany({
      where: {
        campaignId: campaign.id,
        contactId,
        convertedAt: null,
        OR: [
          { sentAt: { not: null, gte: new Date(now.getTime() - windowMs) } },
          // held-out contacts have no sentAt — window runs from launch
          { status: "HELD_OUT", createdAt: { gte: new Date(now.getTime() - windowMs) } },
        ],
      },
      select: { id: true },
    });
    if (messages.length) {
      await db.message.updateMany({
        where: { id: { in: messages.map((m) => m.id) } },
        data: { convertedAt: now },
      });
      converted += messages.length;
      await emitEvents(
        messages.map((m) => makeEvent("message.converted", { messageId: m.id, campaignId: campaign.id, contactId, event }))
      );
    }
  }
  return converted;
}
