import { NextResponse } from "next/server";
import { z } from "zod";
import { Channel } from "@prisma/client";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/enqueue";
import { getAdapter } from "@/lib/channels";
import { campaignPushChannels, fanOut } from "@/lib/campaignFanOut";
import { audit } from "@/lib/audit";

const PUSH_CHANNELS: Channel[] = ["WEB_PUSH", "FCM", "APNS"];

const recipient = z
  .object({
    externalId: z.string().min(1).optional(),
    email: z.string().email().optional(),
    contactId: z.string().optional(),
  })
  .refine((r) => r.externalId || r.email || r.contactId, "externalId, email or contactId required");

const schema = z.object({
  campaignId: z.string().min(1),
  /** Omit to broadcast to the campaign's whole segment (breaking news). Max 1000 per request. */
  recipients: z.array(recipient).max(1000).optional(),
});

/**
 * Server-side send.
 *  - No recipients: launch the campaign now to its full audience.
 *  - With recipients: send the campaign to exactly these users (all their
 *    devices) — personalised / transactional alerts. Callable repeatedly.
 */
export const POST = serverRoute("/api/v1/campaigns/trigger", schema, async ({ body, key }) => {
  const campaign = await db.campaign.findUnique({ where: { id: body.campaignId }, include: { variants: true } });
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (campaign.status === "CANCELED") return NextResponse.json({ error: "campaign is canceled" }, { status: 409 });
  if (!campaign.variants.length) return NextResponse.json({ error: "campaign has no template variants" }, { status: 400 });
  if (!(await getAdapter(campaign.channel).isConfigured())) {
    return NextResponse.json({ error: `${campaign.channel} channel is not configured` }, { status: 400 });
  }
  const actor = key ? `api-key:${key.prefix}` : null;

  if (!body.recipients) {
    if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED" && campaign.status !== "COMPLETED") {
      return NextResponse.json({ error: `campaign is ${campaign.status}` }, { status: 409 });
    }
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "SCHEDULED", scheduledAt: new Date() } });
    await enqueue("LAUNCH_CAMPAIGN", { campaignId: campaign.id });
    await audit({ userEmail: actor, action: "api.campaigns.broadcast", entityType: "campaigns", entityId: campaign.id });
    return NextResponse.json({ ok: true, mode: "broadcast", campaignId: campaign.id }, { status: 202 });
  }

  const externalIds = body.recipients.map((r) => r.externalId).filter(Boolean) as string[];
  const emails = body.recipients.map((r) => r.email?.toLowerCase()).filter(Boolean) as string[];
  const contactIds = body.recipients.map((r) => r.contactId).filter(Boolean) as string[];
  const isPush = PUSH_CHANNELS.includes(campaign.channel);

  const contacts = await db.contact.findMany({
    where: {
      OR: [
        ...(externalIds.length ? [{ externalId: { in: externalIds } }] : []),
        ...(emails.length ? [{ email: { in: emails } }] : []),
        ...(contactIds.length ? [{ id: { in: contactIds } }] : []),
      ],
    },
    select: {
      id: true,
      email: true,
      externalId: true,
      subscriptions: isPush ? { where: { channel: { in: campaignPushChannels(campaign) }, isActive: true }, select: { id: true, channel: true } } : false,
    },
  });

  const suppressed =
    campaign.channel === "EMAIL"
      ? new Set(
          (
            await db.suppression.findMany({
              where: { channel: "EMAIL", address: { in: contacts.map((c) => c.email?.toLowerCase()).filter(Boolean) as string[] } },
              select: { address: true },
            })
          ).map((s) => s.address)
        )
      : new Set<string>();

  const reachable = contacts.filter((c) => (isPush ? (c.subscriptions?.length ?? 0) > 0 : campaign.channel !== "EMAIL" || !!c.email));
  const queued = await fanOut(campaign, reachable, suppressed);
  if (campaign.status === "DRAFT" || campaign.status === "SCHEDULED") {
    await db.campaign.update({
      where: { id: campaign.id },
      data: { status: "RUNNING", launchedAt: campaign.launchedAt ?? new Date(), lastRunAt: new Date() },
    });
  }

  const found = new Set(contacts.flatMap((c) => [c.externalId, c.email, c.id].filter(Boolean) as string[]));
  const notFound = body.recipients.filter((r) => !found.has((r.externalId || r.email?.toLowerCase() || r.contactId)!));
  return NextResponse.json(
    { ok: true, mode: "recipients", matched: contacts.length, reachable: reachable.length, queued, notFound },
    { status: 202 }
  );
});
