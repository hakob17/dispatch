import { NextResponse } from "next/server";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { inboxAction, inboxOwner, ownMessageIds } from "@/lib/inbox";

/** User deleted messages from their message centre. */
export const POST = sdkRoute("/api/sdk/v1/inbox/delete", inboxAction, async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const ids = await ownMessageIds(owner.contact.id, body.messageIds);
  await db.message.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true, updated: ids.length });
});

export const OPTIONS = sdkOptions;
