import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { db } from "@/lib/db";
import { resolveContact } from "@/lib/identity";
import { setSubscriptions } from "@/lib/subscriptions";

/** Every topic and newsletter configured in Dispatch (ids, slugs, kinds). */
export const GET = serverRoute("/api/v1/subscriptions", null, async () => {
  const groups = await db.subscriptionGroup.findMany({ orderBy: [{ optIn: "desc" }, { createdAt: "asc" }] });
  return NextResponse.json({
    groups: groups.map((g) => ({ id: g.id, slug: g.slug, name: g.name, description: g.description, kind: g.optIn ? "newsletter" : "topic" })),
  });
});

const schema = z.object({
  updates: z
    .array(
      z.object({
        externalId: z.string().min(1).max(255).optional(),
        email: z.string().email().optional(),
        anonymousId: z.string().min(8).max(128).optional(),
        /** group id or slug → subscribed */
        groups: z.record(z.string(), z.boolean()),
      })
    )
    .min(1)
    .max(100),
});

/**
 * Subscribe or unsubscribe users from newsletters and topics from your
 * backend (e.g. a sign-up form or CRM sync). Unknown profiles are created.
 */
export const POST = serverRoute("/api/v1/subscriptions", schema, async ({ body }) => {
  const errors: { index: number; error: string }[] = [];
  let processed = 0;
  for (const [index, u] of body.updates.entries()) {
    const contact = await resolveContact({ externalId: u.externalId, email: u.email, anonymousId: u.anonymousId });
    if (!contact) {
      errors.push({ index, error: "externalId, email or anonymousId required" });
      continue;
    }
    const unknown = await setSubscriptions(contact.id, u.groups);
    if (unknown.length) errors.push({ index, error: `unknown group(s): ${unknown.join(", ")}` });
    processed++;
  }
  return NextResponse.json({ processed, errors }, { status: errors.length && !processed ? 400 : 200 });
});
