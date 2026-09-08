import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/enqueue";

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
  const [total, completed, stepStats] = await Promise.all([
    db.journeyRun.count({ where: { journeyId: id } }),
    db.journeyRun.count({ where: { journeyId: id, completedAt: { not: null } } }),
    db.message.groupBy({
      by: ["journeyStepId", "status"],
      where: { journeyStep: { journeyId: id } },
      _count: true,
    }),
  ]);
  return NextResponse.json({ journey, stats: { total, completed, stepStats } });
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
