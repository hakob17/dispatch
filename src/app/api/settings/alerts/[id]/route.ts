import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** Mark an alert resolved by hand (it reopens if the integration fails again). */
export async function PATCH(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.systemAlert.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
