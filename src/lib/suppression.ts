import { Channel, SuppressionReason } from "@prisma/client";
import { db } from "./db";

export async function isSuppressed(channel: Channel, address: string): Promise<boolean> {
  const row = await db.suppression.findUnique({
    where: { channel_address: { channel, address: address.toLowerCase() } },
  });
  return !!row;
}

export async function suppress(
  channel: Channel,
  address: string,
  reason: SuppressionReason
): Promise<void> {
  await db.suppression.upsert({
    where: { channel_address: { channel, address: address.toLowerCase() } },
    create: { channel, address: address.toLowerCase(), reason },
    update: {}, // first reason wins
  });
}

export async function unsuppress(channel: Channel, address: string): Promise<void> {
  await db.suppression.deleteMany({
    where: { channel, address: address.toLowerCase() },
  });
}
