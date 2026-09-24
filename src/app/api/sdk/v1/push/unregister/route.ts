import { NextResponse } from "next/server";
import { z } from "zod";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";

const schema = z.object({
  channel: z.enum(["FCM", "APNS", "WEB_PUSH"]),
  token: z.string().min(10).max(4096),
});

/** Stop sending to this token (user disabled notifications or signed out on a shared device). */
export const POST = sdkRoute("/api/sdk/v1/push/unregister", schema, async ({ body }) => {
  const res = await db.pushSubscription.updateMany({
    where: { channel: body.channel, endpoint: body.token },
    data: { isActive: false },
  });
  return NextResponse.json({ ok: true, deactivated: res.count });
});

export const OPTIONS = sdkOptions;
