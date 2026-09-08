import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDeliveryRules } from "@/lib/deliveryRules";
import { setSetting } from "@/lib/settings";

// Admin-only (middleware).

export async function GET() {
  return NextResponse.json(await getDeliveryRules());
}

const rulesSchema = z.object({
  maxPerDay: z.number().int().positive().nullable(),
  maxPerWeek: z.number().int().positive().nullable(),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
});

export async function POST(req: NextRequest) {
  const body = rulesSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  await setSetting("deliveryRules", body.data);
  return NextResponse.json({ ok: true });
}
