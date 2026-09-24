import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { findContact, mergeContacts, resolveContact } from "./identity";
import { ingestEvents } from "./events";
import { normalizeLanguage } from "./localize";

/**
 * Twilio Segment, both directions.
 *
 * Inbound (Segment → Dispatch): point Segment's "Webhooks" (or "Webhooks
 * (Actions)") destination at /api/integrations/segment with header
 * `Authorization: Bearer <server key>`. Handles identify, track, page, screen,
 * alias and batch payloads (Segment Spec). Push tokens Segment's mobile
 * libraries put in context.device.token are registered too, so cloud-mode
 * integrations keep push working.
 *
 * Outbound (Dispatch → Segment): see segmentOutbound.ts.
 */
export interface SegmentPayload {
  type: "identify" | "track" | "page" | "screen" | "alias" | "group";
  userId?: string | null;
  anonymousId?: string | null;
  previousId?: string;
  event?: string;
  name?: string;
  traits?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  timestamp?: string;
  context?: {
    traits?: Record<string, unknown>;
    locale?: string;
    device?: { token?: string; id?: string; type?: string };
    os?: { name?: string };
    app?: { version?: string };
  };
}

const PROFILE_TRAITS: Record<string, "firstName" | "lastName" | "phone"> = {
  firstName: "firstName",
  first_name: "firstName",
  lastName: "lastName",
  last_name: "lastName",
  phone: "phone",
};
const SKIP_TRAITS = new Set(["email", "name", "id", "userId", "anonymousId", "language", "locale", ...Object.keys(PROFILE_TRAITS)]);

function profileFromTraits(traits: Record<string, unknown> = {}, locale?: string): { profile: Prisma.ContactUpdateInput; attributes: Record<string, unknown> } {
  const profile: Prisma.ContactUpdateInput = {};
  for (const [k, field] of Object.entries(PROFILE_TRAITS)) {
    if (typeof traits[k] === "string") profile[field] = traits[k] as string;
  }
  if (typeof traits.name === "string" && !profile.firstName) {
    const [first, ...rest] = traits.name.split(" ");
    profile.firstName = first;
    if (rest.length) profile.lastName = rest.join(" ");
  }
  const lang = normalizeLanguage((traits.language as string) ?? (traits.locale as string) ?? locale);
  if (lang) profile.language = lang;
  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(traits)) if (!SKIP_TRAITS.has(k)) attributes[k] = v;
  return { profile, attributes };
}

async function registerDeviceToken(contactId: string, p: SegmentPayload): Promise<void> {
  const token = p.context?.device?.token;
  if (!token) return;
  const os = (p.context?.os?.name ?? "").toLowerCase();
  const ios = os.includes("ios") || os.includes("ipados");
  // Segment's iOS library reports the APNs token; Android reports the FCM token
  const channel = ios && /^[0-9a-f]{64,}$/i.test(token) ? "APNS" : "FCM";
  await db.pushSubscription.upsert({
    where: { channel_endpoint: { channel, endpoint: token } },
    create: { contactId, channel, endpoint: token, platform: ios ? "ios" : "android", deviceId: p.context?.device?.id, appVersion: p.context?.app?.version },
    update: { contactId, isActive: true },
  });
}

export async function handleSegmentCall(p: SegmentPayload): Promise<{ ok: boolean; skipped?: string }> {
  const ref = { externalId: p.userId || undefined, anonymousId: p.anonymousId || undefined };
  switch (p.type) {
    case "identify": {
      const traits = { ...(p.context?.traits ?? {}), ...(p.traits ?? {}) };
      const email = typeof traits.email === "string" ? traits.email : undefined;
      const contact = await resolveContact({ ...ref, email });
      if (!contact) return { ok: false, skipped: "no userId/anonymousId" };
      const { profile, attributes } = profileFromTraits(traits, p.context?.locale);
      await resolveContact(
        { contactId: contact.id },
        { ...profile, attributes: { ...((contact.attributes as object) ?? {}), ...attributes } as object }
      );
      await registerDeviceToken(contact.id, p);
      return { ok: true };
    }
    case "track":
    case "page":
    case "screen": {
      const contact = await resolveContact(ref);
      if (!contact) return { ok: false, skipped: "no userId/anonymousId" };
      const name = p.type === "track" ? p.event : p.type === "screen" ? "Screen Viewed" : "Page Viewed";
      if (!name) return { ok: false, skipped: "track without event" };
      const properties = { ...(p.properties ?? {}), ...(p.type !== "track" && p.name ? { name: p.name } : {}) };
      await ingestEvents(contact.id, [{ name, properties, timestamp: p.timestamp }]);
      await registerDeviceToken(contact.id, p);
      return { ok: true };
    }
    case "alias": {
      if (!p.userId || !p.previousId) return { ok: false, skipped: "alias needs userId and previousId" };
      const previous =
        (await findContact({ externalId: p.previousId })) ?? (await findContact({ anonymousId: p.previousId }));
      const target = await resolveContact({ externalId: p.userId });
      if (previous && target && previous.id !== target.id) await mergeContacts(previous.id, target.id);
      return { ok: true };
    }
    case "group":
      return { ok: true, skipped: "group calls are not used" };
  }
}
