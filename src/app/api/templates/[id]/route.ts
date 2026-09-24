import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { templateFields } from "@/lib/templateSchema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(template);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = templateFields.partial().safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const body = parsed.data;
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
      pushImageUrl: body.pushImageUrl === "" ? null : body.pushImageUrl,
      pushPriority: body.pushPriority,
      pushCollapseKey: body.pushCollapseKey,
      pushTtlSeconds: body.pushTtlSeconds,
      pushData: body.pushData === null ? Prisma.DbNull : body.pushData,
      translations: body.translations === null ? Prisma.DbNull : body.translations,
      inAppLayout: body.inAppLayout,
      inAppButtons: body.inAppButtons === null ? Prisma.DbNull : body.inAppButtons,
      inAppExpiresHours: body.inAppExpiresHours,
      cardStyle: body.cardStyle,
      cardPinned: body.cardPinned,
      cardCategory: body.cardCategory === "" ? null : body.cardCategory,
      cardDismissible: body.cardDismissible,
      smsBody: body.smsBody,
      whatsappContentSid: body.whatsappContentSid === "" ? null : body.whatsappContentSid,
      whatsappVariables: body.whatsappVariables === null ? Prisma.DbNull : body.whatsappVariables,
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
