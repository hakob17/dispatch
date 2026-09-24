import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveAlert } from "@/lib/alerts";
import { invalidateEndpointCache } from "@/lib/webhooks/events";

type Params = { params: Promise<{ id: string }> };

/** PATCH { isActive } — pause/resume an endpoint. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { isActive } = await req.json();
  await db.webhookEndpoint.update({ where: { id }, data: { isActive: !!isActive, ...(isActive ? { failureCount: 0 } : {}) } });
  if (isActive) await resolveAlert(`webhook:${id}`); // resumed by an admin: start counting afresh
  invalidateEndpointCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.webhookEndpoint.delete({ where: { id } });
  invalidateEndpointCache();
  return NextResponse.json({ ok: true });
}
