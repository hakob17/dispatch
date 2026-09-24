import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templateSchema } from "@/lib/templateSchema";

export async function GET() {
  const templates = await db.messageTemplate.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const body = templateSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { pushData, pushImageUrl, translations, inAppButtons, whatsappVariables, whatsappContentSid, ...rest } = body.data;
  const template = await db.messageTemplate.create({
    data: {
      ...rest,
      pushImageUrl: pushImageUrl || null,
      ...(pushData ? { pushData } : {}),
      ...(translations ? { translations } : {}),
      ...(inAppButtons ? { inAppButtons } : {}),
      ...(whatsappVariables ? { whatsappVariables } : {}),
      whatsappContentSid: whatsappContentSid || null,
    },
  });
  return NextResponse.json(template, { status: 201 });
}
