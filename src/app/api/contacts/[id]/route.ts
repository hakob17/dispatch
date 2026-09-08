import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const contact = await db.contact.findUnique({
    where: { id },
    include: {
      subscriptions: true,
      events: { orderBy: { createdAt: "desc" }, take: 50 },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { campaign: { select: { name: true } } },
      },
    },
  });
  if (!contact) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(contact);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const contact = await db.contact.update({
    where: { id },
    data: {
      email: body.email ?? undefined,
      phone: body.phone ?? undefined,
      firstName: body.firstName ?? undefined,
      lastName: body.lastName ?? undefined,
      attributes: body.attributes ?? undefined,
    },
  });
  return NextResponse.json(contact);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.contact.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
