import { NextResponse } from "next/server";
import { z } from "zod";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { recordEngagement } from "@/lib/tracking/record";

const schema = z.object({
  messageId: z.string().min(1).max(64),
  action: z.string().max(128).optional(),
});

/** Device-side delivery receipt: the app received the push (foreground handler or notification service extension). */
export const POST = sdkRoute("/api/sdk/v1/push/received", schema, async ({ body }) => {
  const found = await recordEngagement(body.messageId, "DELIVERY", {
    source: "sdk",
    ...(body.action ? { action: body.action } : {}),
  });
  return found
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "unknown messageId" }, { status: 404 });
});

export const OPTIONS = sdkOptions;
