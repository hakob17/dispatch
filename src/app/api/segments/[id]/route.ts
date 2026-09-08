import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const segment = await db.segment.findUnique({ where: { id } });
  if (!segment) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(segment);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const segment = await db.segment.update({
    where: { id },
    data: { name: body.name ?? undefined, filters: body.filters ?? undefined, tags: body.tags ?? undefined },
  });
  return NextResponse.json(segment);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.segment.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
