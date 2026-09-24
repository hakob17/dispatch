import { NextResponse } from "next/server";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { audienceTokens, queueLiveEvent } from "@/lib/liveActivities";
import { keyFromPath, liveOptionsSchema } from "@/lib/liveActivityApi";

/** Push a new content-state to every device showing the activity. */
export const POST = serverRoute("/api/v1/live-activities/:key/update", liveOptionsSchema, async ({ req, body }) => {
  const activity = await db.liveActivity.findUnique({ where: { key: keyFromPath(req.nextUrl.pathname) } });
  if (!activity) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (activity.status === "ENDED") return NextResponse.json({ error: "live activity has ended" }, { status: 409 });
  const updated = await db.liveActivity.update({
    where: { id: activity.id },
    data: { contentState: body.contentState as object },
  });
  const tokens = await audienceTokens(updated, "update");
  const queued = await queueLiveEvent(updated, "update", body, tokens);
  return NextResponse.json({ ok: true, devicesQueued: queued }, { status: 202 });
});
