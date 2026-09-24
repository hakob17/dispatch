import { NextResponse } from "next/server";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { keyFromPath } from "@/lib/liveActivityApi";

/** Status: current state and how many devices are attached. */
export const GET = serverRoute("/api/v1/live-activities/:key", null, async ({ req }) => {
  const activity = await db.liveActivity.findUnique({ where: { key: keyFromPath(req.nextUrl.pathname) } });
  if (!activity) return NextResponse.json({ error: "not found" }, { status: 404 });
  const devices = await db.liveActivityToken.groupBy({
    by: ["kind"],
    where: { activityKey: activity.key, isActive: true },
    _count: { _all: true },
  });
  return NextResponse.json({ ...activity, devices: Object.fromEntries(devices.map((d) => [d.kind, d._count._all])) });
});
