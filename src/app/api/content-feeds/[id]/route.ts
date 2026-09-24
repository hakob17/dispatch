import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/enqueue";

type Params = { params: Promise<{ id: string }> };

const patch = z.object({
  isActive: z.boolean().optional(),
  pollMinutes: z.number().int().min(1).max(1440).optional(),
  autoCampaignId: z.string().nullable().optional(),
  section: z.string().max(100).nullable().optional(),
  pollNow: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = patch.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { pollNow, ...data } = body.data;
  const feed = await db.contentFeed.update({ where: { id }, data });
  if (pollNow) await enqueue("FEED_POLL", { feedId: id });
  return NextResponse.json(feed);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  await db.contentFeed.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
