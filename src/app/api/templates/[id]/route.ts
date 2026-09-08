import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const template = await db.messageTemplate.update({
    where: { id },
    data: {
      name: body.name ?? undefined,
      subject: body.subject,
      htmlBody: body.htmlBody,
      textBody: body.textBody,
      pushTitle: body.pushTitle,
      pushBody: body.pushBody,
      pushUrl: body.pushUrl,
      webhookUrl: body.webhookUrl,
      webhookBody: body.webhookBody,
      tags: body.tags ?? undefined,
    },
  });
  return NextResponse.json(template);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.messageTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
