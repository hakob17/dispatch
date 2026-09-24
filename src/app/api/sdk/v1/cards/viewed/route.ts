import { NextResponse } from "next/server";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { inboxAction, inboxOwner, ownMessageIds } from "@/lib/inbox";
import { recordEngagement } from "@/lib/tracking/record";

/** Cards scrolled into view (impressions) — recorded once per card as an open. */
export const POST = sdkRoute("/api/sdk/v1/cards/viewed", inboxAction, async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const ids = await ownMessageIds(owner.contact.id, body.messageIds, "CONTENT_CARD");
  for (const id of ids) await recordEngagement(id, "OPEN", { source: "card" });
  return NextResponse.json({ ok: true, updated: ids.length });
});

export const OPTIONS = sdkOptions;
