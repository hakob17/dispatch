import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { findContact } from "@/lib/identity";
import { audit } from "@/lib/audit";

const schema = z
  .object({ externalId: z.string().optional(), email: z.string().email().optional() })
  .refine((b) => b.externalId || b.email, "externalId or email required");

/** Data subject access request: everything Dispatch holds about one person, as JSON. */
export const GET = serverRoute("/api/v1/users/export", schema, async ({ body, key }) => {
  const found = await findContact(body);
  if (!found) return NextResponse.json({ error: "not found" }, { status: 404 });
  const contact = await db.contact.findUnique({
    where: { id: found.id },
    include: {
      subscriptions: true,
      events: { orderBy: { createdAt: "asc" } },
      subscriptionStates: { include: { group: { select: { name: true } } } },
      journeyRuns: true,
      messages: { orderBy: { createdAt: "asc" }, include: { events: true } },
    },
  });
  const suppressions = contact?.email
    ? await db.suppression.findMany({ where: { address: contact.email.toLowerCase() } })
    : [];
  await audit({ userEmail: key ? `api-key:${key.prefix}` : null, action: "api.users.export", entityType: "contacts", entityId: found.id });
  return NextResponse.json({ exportedAt: new Date().toISOString(), contact, suppressions });
});
