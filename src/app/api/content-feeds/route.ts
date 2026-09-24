import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/queue/enqueue";

export async function GET() {
  const feeds = await db.contentFeed.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(feeds);
}

const schema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  section: z.string().max(100).nullable().optional(),
  pollMinutes: z.number().int().min(1).max(1440).default(5),
  autoCampaignId: z.string().nullable().optional(),
});

/** Add a feed; the first fetch imports its current items without sending anything. */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    const feed = await db.contentFeed.create({ data: body.data });
    await enqueue("FEED_POLL", { feedId: feed.id });
    return NextResponse.json(feed, { status: 201 });
  } catch {
    return NextResponse.json({ error: "that feed URL is already added" }, { status: 409 });
  }
}
