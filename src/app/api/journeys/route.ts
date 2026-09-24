import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { journeySchema, journeyStepsFrom } from "@/lib/journeys";

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
  const parsed = journeySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const graph = await journeyStepsFrom(parsed.data);
  if ("error" in graph) return graph.error;
  const { name, segmentId, triggerEvent, exitEvent } = parsed.data;
  const journey = await db.journey.create({
    data: {
      name,
      segmentId: segmentId || null,
      triggerEvent: triggerEvent || null,
      exitEvent: exitEvent || null,
      entryKey: graph.entryKey,
      steps: { createMany: { data: graph.steps } },
    },
    include: { steps: true },
  });
  return NextResponse.json(journey, { status: 201 });
}
