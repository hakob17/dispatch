import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export async function GET() {
  const groups = await db.subscriptionGroup.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { states: { where: { subscribed: false } }, campaigns: true } } },
  });
  return NextResponse.json(groups);
}

const groupSchema = z.object({ name: z.string().min(1), description: z.string().optional() });

export async function POST(req: NextRequest) {
  const body = groupSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    const group = await db.subscriptionGroup.create({ data: body.data });
    return NextResponse.json(group, { status: 201 });
  } catch {
    return NextResponse.json({ error: "name already exists" }, { status: 409 });
  }
}
