import { NextRequest, NextResponse } from "next/server";
import { Channel } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/enqueue";
import { filtersToWhere, SegmentFilter } from "@/lib/segments/resolve";
import { requireApiKey } from "@/lib/apiAuth";

const trackSchema = z.object({
  email: z.string().email().optional(),
  contactId: z.string().optional(),
  event: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
});

const PUSH_CHANNELS: Channel[] = ["WEB_PUSH", "FCM", "APNS"];

/**
 * Braze-style custom event tracking.
 * POST { email | contactId, event, properties? }
 * Creates the contact if the email is unknown, fires event-triggered
 * campaigns, and attributes conversions.
 */
export async function POST(req: NextRequest) {
  const denied = await requireApiKey(req, "/api/track");
  if (denied) return denied;

  const body = trackSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { email, contactId, event, properties } = body.data;

  let contact = null;
  if (contactId) contact = await db.contact.findUnique({ where: { id: contactId } });
  else if (email) {
    contact = await db.contact.upsert({
      where: { email: email.toLowerCase() },
      create: { email: email.toLowerCase() },
      update: {},
    });
  }
  if (!contact) return NextResponse.json({ error: "contact not found" }, { status: 404 });

  const created = await db.contactEvent.create({
    data: { contactId: contact.id, name: event, properties: (properties ?? {}) as object },
  });

  const [triggered, conversions] = await Promise.all([
    fireTriggeredCampaigns(contact.id, event),
    attributeConversions(contact.id, event),
  ]);

  return NextResponse.json(
    { ok: true, eventId: created.id, triggeredCampaigns: triggered, conversions },
    { status: 201 }
  );
}

/** Fire RUNNING event-triggered campaigns matching this event (once per contact per campaign). */
async function fireTriggeredCampaigns(contactId: string, event: string): Promise<number> {
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
        where: { contactId, channel: campaign.channel, isActive: true },
        select: { id: true },
      });
      for (const sub of subs) {
        const msg = await db.message.create({
          data: { campaignId: campaign.id, variantId: variant.id, contactId, pushSubscriptionId: sub.id, channel: campaign.channel, status: "QUEUED" },
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
async function attributeConversions(contactId: string, event: string): Promise<number> {
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
    }
  }
  return converted;
}
