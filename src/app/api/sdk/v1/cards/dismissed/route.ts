import { NextResponse } from "next/server";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { inboxAction, inboxOwner, ownMessageIds } from "@/lib/inbox";

/** Reader swiped cards away — gone from every device. Cards marked non-dismissible stay. */
export const POST = sdkRoute("/api/sdk/v1/cards/dismissed", inboxAction, async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const ids = await ownMessageIds(owner.contact.id, body.messageIds, "CONTENT_CARD");
  const { count } = await db.message.updateMany({
    where: { id: { in: ids }, deletedAt: null, NOT: { content: { path: ["dismissible"], equals: false } } },
    data: { deletedAt: new Date() },
  });
  return NextResponse.json({ ok: true, updated: count });
});

export const OPTIONS = sdkOptions;
