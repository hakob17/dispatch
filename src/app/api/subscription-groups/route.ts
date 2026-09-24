import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groupSchema } from "@/lib/subscriptions";

/** Topics and newsletters, with explicit subscribe / opt-out counts. */
export async function GET() {
  const [groups, counts] = await Promise.all([
    db.subscriptionGroup.findMany({
      orderBy: [{ optIn: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { campaigns: true } } },
    }),
    db.subscriptionState.groupBy({ by: ["groupId", "subscribed"], _count: { _all: true } }),
  ]);
  const n = (groupId: string, subscribed: boolean) =>
    counts.find((c) => c.groupId === groupId && c.subscribed === subscribed)?._count._all ?? 0;
  return NextResponse.json(
    groups.map((g) => ({
      ...g,
      kind: g.optIn ? "newsletter" : "topic",
      subscribers: n(g.id, true),
      optedOut: n(g.id, false),
    }))
  );
}

export async function POST(req: NextRequest) {
  const body = groupSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    const group = await db.subscriptionGroup.create({ data: body.data });
    return NextResponse.json(group, { status: 201 });
  } catch {
    return NextResponse.json({ error: "name or slug already exists" }, { status: 409 });
  }
}
