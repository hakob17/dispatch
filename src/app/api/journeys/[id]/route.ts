import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/enqueue";
import { journeySchema, journeyStepsFrom } from "@/lib/journeys";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const journey = await db.journey.findUnique({
    where: { id },
    include: {
      segment: { select: { id: true, name: true } },
      steps: { orderBy: { order: "asc" }, include: { template: { select: { id: true, name: true } } } },
    },
  });
  if (!journey) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [total, completed, waiting, stepStats, visits, exits] = await Promise.all([
    db.journeyRun.count({ where: { journeyId: id } }),
    db.journeyRun.count({ where: { journeyId: id, completedAt: { not: null } } }),
    db.journeyRun.count({ where: { journeyId: id, completedAt: null, waitingEvent: { not: null } } }),
    db.message.groupBy({
      by: ["journeyStepId", "status"],
      where: { journeyStep: { journeyId: id } },
      _count: true,
    }),
    // Path analytics: how many contacts passed each node, and which branch they took
    db.journeyVisit.groupBy({ by: ["nodeKey", "branch"], where: { journeyId: id }, _count: { _all: true } }),
    db.journeyRun.groupBy({ by: ["exitReason"], where: { journeyId: id, completedAt: { not: null } }, _count: { _all: true } }),
  ]);
  return NextResponse.json({
    journey,
    stats: {
      total,
      completed,
      waiting,
      stepStats,
      visits: visits.map((v) => ({ nodeKey: v.nodeKey, branch: v.branch, count: v._count._all })),
      exits: exits.map((e) => ({ reason: e.exitReason ?? "completed", count: e._count._all })),
    },
  });
}

/** Replace a DRAFT journey's definition (name, audience, trigger/exit events, steps or nodes). */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const existing = await db.journey.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.status !== "DRAFT") return NextResponse.json({ error: "only draft journeys can be edited — pause and duplicate instead" }, { status: 409 });
  const parsed = journeySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const graph = await journeyStepsFrom(parsed.data);
  if ("error" in graph) return graph.error;
  const { name, segmentId, triggerEvent, exitEvent } = parsed.data;
  await db.$transaction([
    db.journeyStep.deleteMany({ where: { journeyId: id } }),
    db.journey.update({
      where: { id },
      data: {
        name,
        segmentId: segmentId || null,
        triggerEvent: triggerEvent || null,
        exitEvent: exitEvent || null,
        entryKey: graph.entryKey,
        steps: { createMany: { data: graph.steps } },
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}

/** PATCH { action: "activate" | "pause" | "archive" } */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { action } = await req.json();
  const map = { activate: "ACTIVE", pause: "PAUSED", archive: "ARCHIVED" } as const;
  const status = map[action as keyof typeof map];
  if (!status) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  await db.journey.update({ where: { id }, data: { status } });
  if (status === "ACTIVE") {
    await enqueue("ENROLL_JOURNEY", { journeyId: id });
  }
  return NextResponse.json({ ok: true, status });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.journey.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
