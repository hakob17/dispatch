import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { upsertItems } from "@/lib/feeds";
import { enqueue } from "@/lib/queue/enqueue";
import { normalizeLanguage } from "@/lib/localize";
import { db } from "@/lib/db";

const schema = z.object({
  items: z
    .array(
      z.object({
        externalId: z.string().min(1).max(255),
        title: z.string().min(1).max(300),
        url: z.string().min(1).max(2000),
        summary: z.string().max(2000).nullable().optional(),
        imageUrl: z.string().url().nullable().optional(),
        section: z.string().max(100).nullable().optional(),
        tags: z.array(z.string().max(100)).max(50).default([]),
        language: z.string().max(35).nullable().optional(),
        publishedAt: z.string().datetime({ offset: true }).optional(),
        expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
      })
    )
    .min(1)
    .max(500),
  /** Launch this campaign once per NEW item (CMS-driven breaking news; {{item.title}}, {{item.url}}…) */
  sendCampaignId: z.string().optional(),
});

/** Add/update articles in the recommendation catalog — call from your CMS on publish. */
export const POST = serverRoute("/api/v1/content/items", schema, async ({ body }) => {
  if (body.sendCampaignId && !(await db.campaign.findUnique({ where: { id: body.sendCampaignId }, select: { id: true } }))) {
    return NextResponse.json({ error: "sendCampaignId not found" }, { status: 404 });
  }
  const created = await upsertItems(
    body.items.map((i) => ({
      ...i,
      summary: i.summary ?? null,
      imageUrl: i.imageUrl ?? null,
      section: i.section ?? null,
      language: normalizeLanguage(i.language),
      publishedAt: i.publishedAt ? new Date(i.publishedAt) : new Date(),
      expiresAt: i.expiresAt ? new Date(i.expiresAt) : null,
    }))
  );
  if (body.sendCampaignId) {
    for (const c of created) await enqueue("LAUNCH_CAMPAIGN", { campaignId: body.sendCampaignId, contentItemId: c.id });
  }
  return NextResponse.json({ ok: true, received: body.items.length, created: created.length, launched: body.sendCampaignId ? created.length : 0 });
});
