import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { inboxOwner } from "@/lib/inbox";
import { recordEngagement } from "@/lib/tracking/record";

const schema = identitySchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(50) });

/**
 * The user's message centre: unexpired, undeleted in-app messages, newest first.
 * `display` is true for messages the app should pop up (modal/banner/fullscreen)
 * that haven't been shown yet. Fetching counts as delivery.
 */
export const GET = sdkRoute("/api/sdk/v1/inbox", schema, async ({ body }) => {
  const owner = await inboxOwner(body);
  if ("error" in owner) return owner.error!;
  const now = new Date();
  const rows = await db.message.findMany({
    where: {
      contactId: owner.contact.id,
      channel: "IN_APP",
      status: { in: ["SENT", "DELIVERED"] },
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { sentAt: "desc" },
    take: body.limit,
    select: { id: true, content: true, sentAt: true, readAt: true, openedAt: true, expiresAt: true, status: true },
  });
  // First fetch = delivered (not awaited: the list must not wait on bookkeeping)
  for (const r of rows) if (r.status === "SENT") void recordEngagement(r.id, "DELIVERY", { source: "inbox" }).catch(() => {});
  const messages = rows.map((r) => {
    const c = (r.content ?? {}) as { layout?: string };
    return {
      id: r.id,
      ...(r.content as object),
      sentAt: r.sentAt,
      expiresAt: r.expiresAt,
      read: !!r.readAt,
      display: c.layout !== "INBOX" && !r.openedAt,
    };
  });
  return NextResponse.json({ unread: messages.filter((m) => !m.read).length, messages });
});

export const OPTIONS = sdkOptions;
