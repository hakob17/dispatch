import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

/** Revoke (not delete — usage history stays). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
