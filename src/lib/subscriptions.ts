import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Two kinds of subscription group:
 *  - topic (optIn=false): everyone receives it until they opt out;
 *  - newsletter (optIn=true): nobody receives it until they subscribe.
 * A SubscriptionState row, when present, always wins.
 */
export type GroupKind = { id: string; optIn: boolean };

export function isSubscribed(group: { optIn: boolean }, state: boolean | undefined | null): boolean {
  return state ?? !group.optIn;
}

/** Contacts a campaign on this group may reach. */
export function groupAudienceWhere(group: GroupKind): Prisma.ContactWhereInput {
  return group.optIn
    ? { subscriptionStates: { some: { groupId: group.id, subscribed: true } } }
    : { NOT: { subscriptionStates: { some: { groupId: group.id, subscribed: false } } } };
}

/** Accepts group ids or slugs; returns the matching groups keyed by what the caller passed. */
export async function resolveGroups(keys: string[]) {
  if (!keys.length) return new Map<string, { id: string; name: string; optIn: boolean }>();
  const groups = await db.subscriptionGroup.findMany({
    where: { OR: [{ id: { in: keys } }, { slug: { in: keys } }] },
    select: { id: true, slug: true, name: true, optIn: true },
  });
  const out = new Map<string, { id: string; name: string; optIn: boolean }>();
  for (const g of groups) {
    out.set(g.id, g);
    if (g.slug) out.set(g.slug, g);
  }
  return out;
}

/** Sets subscription states by group id or slug. Unknown keys are returned, not thrown. */
export async function setSubscriptions(contactId: string, changes: Record<string, boolean>): Promise<string[]> {
  const groups = await resolveGroups(Object.keys(changes));
  const unknown: string[] = [];
  for (const [key, subscribed] of Object.entries(changes)) {
    const g = groups.get(key);
    if (!g) {
      unknown.push(key);
      continue;
    }
    await db.subscriptionState.upsert({
      where: { groupId_contactId: { groupId: g.id, contactId } },
      create: { groupId: g.id, contactId, subscribed },
      update: { subscribed },
    });
  }
  return unknown;
}

/** Every group with this contact's effective state — what preference centres show. */
export async function preferencesFor(contactId: string | null) {
  const [groups, states] = await Promise.all([
    db.subscriptionGroup.findMany({ orderBy: [{ optIn: "asc" }, { createdAt: "asc" }] }),
    contactId ? db.subscriptionState.findMany({ where: { contactId } }) : Promise.resolve([]),
  ]);
  const map = new Map(states.map((s) => [s.groupId, s.subscribed]));
  return groups.map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    kind: g.optIn ? ("newsletter" as const) : ("topic" as const),
    subscribed: isSubscribed(g, map.get(g.id)),
  }));
}

/** Console create/update body for a topic or newsletter. */
export const groupSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  optIn: z.boolean().optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "lowercase letters, digits and dashes")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
