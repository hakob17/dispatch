import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const campaignSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["EMAIL", "WEB_PUSH", "FCM", "APNS", "WEBHOOK", "IN_APP", "CONTENT_CARD", "SMS", "WHATSAPP"]),
  segmentId: z.string().nullable().optional(),
  trigger: z.enum(["SCHEDULED", "EVENT"]).default("SCHEDULED"),
  triggerEvent: z.string().nullable().optional(),
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY"]).default("NONE"),
  conversionEvent: z.string().nullable().optional(),
  conversionWindowHours: z.number().int().min(1).max(720).default(72),
  controlGroupPct: z.number().int().min(0).max(50).default(0),
  subscriptionGroupId: z.string().nullable().optional(),
  allPushPlatforms: z.boolean().default(false),
  sendTimeOptimization: z.boolean().default(false),
  bypassDeliveryRules: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  variants: z
    .array(z.object({ templateId: z.string(), name: z.string().default("A"), weight: z.number().int().min(1).max(100) }))
    .min(1),
});

export async function GET() {
  const campaigns = await db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      segment: { select: { name: true } },
      subscriptionGroup: { select: { name: true, optIn: true } },
      variants: { include: { template: { select: { name: true } } } },
      _count: { select: { messages: true } },
    },
  });
  return NextResponse.json(campaigns);
}

export async function POST(req: NextRequest) {
  const body = campaignSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { variants, ...data } = body.data;
  const totalWeight = variants.reduce((s, v) => s + v.weight, 0);
  if (totalWeight !== 100) {
    return NextResponse.json({ error: "variant weights must sum to 100" }, { status: 400 });
  }
  if (data.trigger === "EVENT" && !data.triggerEvent) {
    return NextResponse.json({ error: "event-triggered campaigns need a trigger event name" }, { status: 400 });
  }
  if (data.allPushPlatforms && !["FCM", "APNS", "WEB_PUSH"].includes(data.channel)) data.allPushPlatforms = false;
  if (data.sendTimeOptimization && (data.bypassDeliveryRules || data.trigger === "EVENT")) {
    return NextResponse.json({ error: "send-time optimisation is for scheduled campaigns that aren't breaking news" }, { status: 400 });
  }
  const campaign = await db.campaign.create({
    data: { ...data, variants: { create: variants } },
    include: { variants: true },
  });
  return NextResponse.json(campaign, { status: 201 });
}
