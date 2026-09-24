import { NextResponse } from "next/server";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { inboxAction, inboxOwner, ownMessageIds } from "@/lib/inbox";
import { recordEngagement } from "@/lib/tracking/record";

/** Mark messages read in the message centre (counts as an open). */
export const POST = sdkRoute("/api/sdk/v1/inbox/read", inboxAction, async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const ids = await ownMessageIds(owner.contact.id, body.messageIds);
  await db.message.updateMany({ where: { id: { in: ids }, readAt: null }, data: { readAt: new Date() } });
  for (const id of ids) await recordEngagement(id, "OPEN", { source: "inbox" });
  return NextResponse.json({ ok: true, updated: ids.length });
});

export const OPTIONS = sdkOptions;
