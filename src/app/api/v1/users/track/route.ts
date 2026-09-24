import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { resolveContact, type IdentityRef } from "@/lib/identity";
import { ingestEvents } from "@/lib/events";
import { normalizeLanguage } from "@/lib/localize";

const ref = {
  externalId: z.string().min(1).max(255).optional(),
  email: z.string().email().optional(),
  anonymousId: z.string().min(8).max(128).optional(),
};

const schema = z.object({
  attributes: z
    .array(
      z.object({
        ...ref,
        firstName: z.string().nullable().optional(),
        lastName: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        language: z.string().max(35).nullable().optional(),
        /** Custom attributes, shallow-merged; null deletes a key */
        attributes: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .max(100)
    .default([]),
  events: z
    .array(
      z.object({
        ...ref,
        name: z.string().min(1).max(255),
        properties: z.record(z.string(), z.unknown()).optional(),
        timestamp: z.string().datetime({ offset: true }).optional(),
      })
    )
    .max(100)
    .default([]),
});

/**
 * Bulk profile + event ingestion (e.g. from your CDP / Segment / backend).
 * Up to 100 attribute objects and 100 events per request; each attribute
 * object may change any number of fields on one profile.
 */
export const POST = serverRoute("/api/v1/users/track", schema, async ({ body }) => {
  const errors: { index: number; kind: string; error: string }[] = [];
  let attributesProcessed = 0;
  let eventsProcessed = 0;

  for (const [index, a] of body.attributes.entries()) {
    const { externalId, email, anonymousId, attributes, language, ...fields } = a;
    const idRef: IdentityRef = { externalId, email, anonymousId };
    const contact = await resolveContact(idRef);
    if (!contact) {
      errors.push({ index, kind: "attributes", error: "externalId, email or anonymousId required" });
      continue;
    }
    const merged: Record<string, unknown> = { ...((contact.attributes as object) ?? {}) };
    for (const [k, v] of Object.entries(attributes ?? {})) {
      if (v === null) delete merged[k];
      else merged[k] = v;
    }
    await resolveContact(
      { contactId: contact.id },
      { ...fields, ...(language !== undefined ? { language: normalizeLanguage(language) } : {}), attributes: merged as object }
    );
    attributesProcessed++;
  }

  for (const [index, e] of body.events.entries()) {
    const contact = await resolveContact({ externalId: e.externalId, email: e.email, anonymousId: e.anonymousId });
    if (!contact) {
      errors.push({ index, kind: "events", error: "externalId, email or anonymousId required" });
      continue;
    }
    await ingestEvents(contact.id, [{ name: e.name, properties: e.properties, timestamp: e.timestamp }]);
    eventsProcessed++;
  }

  return NextResponse.json({ ok: errors.length === 0, attributesProcessed, eventsProcessed, errors }, { status: errors.length ? 207 : 200 });
});
