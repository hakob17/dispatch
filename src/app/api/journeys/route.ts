import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const journeySchema = z.object({
  name: z.string().min(1),
  segmentId: z.string().nullable().optional(),
  steps: z
    .array(
      z.object({
        delayMinutes: z.number().int().min(0),
        channel: z.enum(["EMAIL", "WEB_PUSH", "FCM", "APNS", "WEBHOOK", "SMS", "WHATSAPP"]),
        templateId: z.string(),
      })
    )
    .min(1),
});

export async function GET() {
  const journeys = await db.journey.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      segment: { select: { name: true } },
      steps: { orderBy: { order: "asc" }, include: { template: { select: { name: true } } } },
      _count: { select: { runs: true } },
    },
  });
  return NextResponse.json(journeys);
}

export async function POST(req: NextRequest) {
  const body = journeySchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { steps, ...data } = body.data;
  const journey = await db.journey.create({
    data: {
      ...data,
      steps: { create: steps.map((s, i) => ({ ...s, order: i })) },
    },
    include: { steps: true },
  });
  return NextResponse.json(journey, { status: 201 });
}
