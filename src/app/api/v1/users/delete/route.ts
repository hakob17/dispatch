import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

const schema = z
  .object({
    externalIds: z.array(z.string().min(1)).max(100).default([]),
    emails: z.array(z.string().email()).max(100).default([]),
  })
  .refine((b) => b.externalIds.length + b.emails.length > 0, "externalIds or emails required");

/**
 * Right-to-erasure (GDPR Art. 17 / CCPA delete). Removes the profile and
 * everything attached to it (devices, events, messages, subscription state).
 * The email stays on the suppression list if it was suppressed, so the person
 * is never re-mailed after re-import.
 */
export const POST = serverRoute("/api/v1/users/delete", schema, async ({ body, key }) => {
  const contacts = await db.contact.findMany({
    where: {
      OR: [
        ...(body.externalIds.length ? [{ externalId: { in: body.externalIds } }] : []),
        ...(body.emails.length ? [{ email: { in: body.emails.map((e) => e.toLowerCase()) } }] : []),
      ],
    },
    select: { id: true },
  });
  const res = await db.contact.deleteMany({ where: { id: { in: contacts.map((c) => c.id) } } });
  await audit({
    userEmail: key ? `api-key:${key.prefix}` : null,
    action: "api.users.delete",
    entityType: "contacts",
    meta: { requested: body.externalIds.length + body.emails.length, deleted: res.count },
  });
  return NextResponse.json({ ok: true, deleted: res.count });
});
