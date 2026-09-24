import { NextResponse } from "next/server";
import { z } from "zod";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { inboxAction, inboxOwner, ownMessageIds } from "@/lib/inbox";
import { recordEngagement } from "@/lib/tracking/record";

/** User tapped the message or one of its buttons. */
export const POST = sdkRoute("/api/sdk/v1/inbox/clicked", inboxAction.extend({ url: z.string().max(2000).optional() }), async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const ids = await ownMessageIds(owner.contact.id, body.messageIds);
  for (const id of ids) await recordEngagement(id, "CLICK", { source: "in-app", ...(body.url ? { url: body.url } : {}) });
  await db.message.updateMany({ where: { id: { in: ids }, readAt: null }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true, updated: ids.length });
});

export const OPTIONS = sdkOptions;
