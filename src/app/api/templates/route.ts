import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const templateSchema = z.object({
  name: z.string().min(1),
  channel: z.enum(["EMAIL", "WEB_PUSH", "FCM", "APNS", "WEBHOOK", "SMS", "WHATSAPP"]),
  subject: z.string().nullable().optional(),
  htmlBody: z.string().nullable().optional(),
  textBody: z.string().nullable().optional(),
  pushTitle: z.string().nullable().optional(),
  pushBody: z.string().nullable().optional(),
  pushUrl: z.string().nullable().optional(),
  webhookUrl: z.string().nullable().optional(),
  webhookBody: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
});

export async function GET() {
  const templates = await db.messageTemplate.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const body = templateSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const template = await db.messageTemplate.create({ data: body.data });
  return NextResponse.json(template, { status: 201 });
}
