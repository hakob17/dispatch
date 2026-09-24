import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { emitEvents, makeEvent, messageEventData, type EventTypeName } from "../webhooks/events";

type Kind = "OPEN" | "CLICK" | "DELIVERY";

const FIRST_FIELD = { OPEN: "openedAt", CLICK: "clickedAt", DELIVERY: "deliveredAt" } as const;
const OUT_TYPE: Record<Kind, EventTypeName> = { OPEN: "message.opened", CLICK: "message.clicked", DELIVERY: "message.delivered" };

/**
 * Record an engagement event for a message: audit-trail row, first-time
 * timestamp, and an outbound webhook event. Used by the email pixel/click
 * endpoints and by the SDK's push received/opened reports.
 * Returns false when the message does not exist.
 */
export async function recordEngagement(messageId: string, kind: Kind, meta?: Prisma.InputJsonValue): Promise<boolean> {
  const msg = await db.message.findUnique({
    where: { id: messageId },
    include: { contact: { select: { externalId: true } } },
  });
  if (!msg) return false;

  const field = FIRST_FIELD[kind];
  await db.messageEvent.create({ data: { messageId, type: kind, meta } });
  if (!msg[field]) await db.message.update({ where: { id: messageId }, data: { [field]: new Date() } });
  // A device-confirmed delivery (or an open, which implies one) upgrades SENT → DELIVERED.
  // SENDING too: a fast device can report before the worker has written SENT (the worker
  // then keeps DELIVERED). Conditional update, so concurrent receipts can't race it.
  if (kind !== "CLICK") {
    await db.message.updateMany({
      where: { id: messageId, status: { in: ["SENDING", "SENT"] } },
      data: { status: "DELIVERED", ...(msg.deliveredAt ? {} : { deliveredAt: new Date() }) },
    });
  }
  await emitEvents([
    makeEvent(OUT_TYPE[kind], {
      ...messageEventData({ ...msg, externalId: msg.contact.externalId }),
      ...(meta && typeof meta === "object" ? { meta } : {}),
    }),
  ]);
  return true;
}
