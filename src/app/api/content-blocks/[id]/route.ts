import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const block = await db.contentBlock.update({
    where: { id },
    data: { name: body.name ?? undefined, content: body.content ?? undefined },
  });
  return NextResponse.json(block);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.contentBlock.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
