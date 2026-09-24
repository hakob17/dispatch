import { NextResponse } from "next/server";
import { z } from "zod";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { recordEngagement } from "@/lib/tracking/record";

const schema = z.object({
  messageId: z.string().min(1).max(64),
  action: z.string().max(128).optional(),
});

/** The user tapped the notification (including cold start). */
export const POST = sdkRoute("/api/sdk/v1/push/opened", schema, async ({ body }) => {
  const found = await recordEngagement(body.messageId, "OPEN", {
    source: "sdk",
    ...(body.action ? { action: body.action } : {}),
  });
  return found
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "unknown messageId" }, { status: 404 });
});

export const OPTIONS = sdkOptions;
