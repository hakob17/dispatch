import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { hasIdentity, resolveContact } from "@/lib/identity";
import { normalizeLanguage } from "@/lib/localize";

const schema = identitySchema.extend({
  firstName: z.string().max(255).nullable().optional(),
  lastName: z.string().max(255).nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  /** BCP-47 language (device locale) — picks template translations */
  language: z.string().max(35).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Create/update the profile for this device. Call with just `anonymousId`
 * on first launch, then with `anonymousId + externalId` at sign-in — the
 * anonymous history is merged into the known profile.
 */
export const POST = sdkRoute("/api/sdk/v1/identify", schema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const { externalId, anonymousId, email, attributes, language, ...fields } = body;

  const existing = await resolveContact({ externalId, anonymousId, email });
  if (!existing) return NextResponse.json({ error: "could not resolve contact" }, { status: 400 });
  const contact = await resolveContact(
    { contactId: existing.id },
    {
      ...fields,
      ...(language !== undefined ? { language: normalizeLanguage(language) } : {}),
      ...(attributes ? { attributes: { ...((existing.attributes as object) ?? {}), ...attributes } as object } : {}),
    }
  );
  return NextResponse.json({ ok: true, contactId: contact!.id, externalId: contact!.externalId });
});

export const OPTIONS = sdkOptions;
