import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invalidateKeyCache } from "@/lib/apiAuth";

type Params = { params: Promise<{ id: string }> };

/** Revoke (not delete — usage history stays). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  invalidateKeyCache();
  return NextResponse.json({ ok: true });
}
