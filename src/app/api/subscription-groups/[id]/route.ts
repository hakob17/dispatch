import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { groupSchema } from "@/lib/subscriptions";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = groupSchema.partial().safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json(await db.subscriptionGroup.update({ where: { id }, data: body.data }));
  } catch {
    return NextResponse.json({ error: "not found, or name/slug already exists" }, { status: 409 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.subscriptionGroup.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
