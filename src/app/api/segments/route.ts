import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const segmentSchema = z.object({
  name: z.string().min(1),
  filters: z.array(
    z.object({
      field: z.string(),
      op: z.enum(["eq", "neq", "contains", "exists", "gt", "lt"]),
      value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    })
  ),
  tags: z.array(z.string()).default([]),
});

export async function GET() {
  const segments = await db.segment.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { campaigns: true } } },
  });
  return NextResponse.json(segments);
}

export async function POST(req: NextRequest) {
  const body = segmentSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const segment = await db.segment.create({ data: body.data });
  return NextResponse.json(segment, { status: 201 });
}
