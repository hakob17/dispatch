import { NextResponse } from "next/server";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { inboxAction, inboxOwner, ownMessageIds } from "@/lib/inbox";
import { recordEngagement } from "@/lib/tracking/record";

/** The app showed an in-app message (modal/banner): counts as an open, and it won't pop up again. */
export const POST = sdkRoute("/api/sdk/v1/inbox/displayed", inboxAction, async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const ids = await ownMessageIds(owner.contact.id, body.messageIds);
  for (const id of ids) await recordEngagement(id, "OPEN", { source: "in-app display" });
  return NextResponse.json({ ok: true, updated: ids.length });
});

export const OPTIONS = sdkOptions;
