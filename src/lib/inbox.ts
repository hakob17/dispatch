import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "./db";
import { findContact, hasIdentity } from "./identity";
import { identitySchema } from "./sdkApi";

export const inboxAction = identitySchema.extend({ messageIds: z.array(z.string().min(1).max(64)).min(1).max(200) });

/** The contact behind an SDK inbox call, or an error response. */
export async function inboxOwner(body: z.infer<typeof identitySchema>) {
  if (!hasIdentity(body)) return { error: NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 }) };
  const contact = await findContact(body);
  if (!contact) return { error: NextResponse.json({ error: "unknown user" }, { status: 404 }) };
  return { contact };
}

/** Only this user's in-app messages (or cards): SDK keys are public, so ids alone prove nothing. */
export async function ownMessageIds(contactId: string, ids: string[], channel: "IN_APP" | "CONTENT_CARD" = "IN_APP"): Promise<string[]> {
  return (await db.message.findMany({ where: { id: { in: ids }, contactId, channel }, select: { id: true } })).map((m) => m.id);
}
