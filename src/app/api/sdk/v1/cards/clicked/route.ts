import { NextResponse } from "next/server";
import { z } from "zod";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { inboxAction, inboxOwner, ownMessageIds } from "@/lib/inbox";
import { recordEngagement } from "@/lib/tracking/record";

/** Reader tapped a card (or its button). */
export const POST = sdkRoute("/api/sdk/v1/cards/clicked", inboxAction.extend({ url: z.string().max(2000).optional() }), async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const ids = await ownMessageIds(owner.contact.id, body.messageIds, "CONTENT_CARD");
  for (const id of ids) {
    await recordEngagement(id, "OPEN", { source: "card" }); // a click implies it was seen
    await recordEngagement(id, "CLICK", { source: "card", ...(body.url ? { url: body.url } : {}) });
  }
  return NextResponse.json({ ok: true, updated: ids.length });
});

export const OPTIONS = sdkOptions;
