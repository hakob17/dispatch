import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { findContact, hasIdentity, resolveContact } from "@/lib/identity";
import { preferencesFor, setSubscriptions } from "@/lib/subscriptions";

/**
 * In-app preference centre: every topic and newsletter with this user's state.
 * Topics default to subscribed, newsletters to not subscribed.
 */
export const GET = sdkRoute("/api/sdk/v1/preferences", identitySchema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const contact = await findContact(body);
  return NextResponse.json({ groups: await preferencesFor(contact?.id ?? null) });
});

const putSchema = identitySchema.extend({ groups: z.record(z.string(), z.boolean()) });

export const PUT = sdkRoute("/api/sdk/v1/preferences", putSchema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const contact = await resolveContact(body);
  if (!contact) return NextResponse.json({ error: "could not resolve contact" }, { status: 400 });
  await setSubscriptions(contact.id, body.groups); // keys may be group ids or slugs; unknown keys are ignored
  return NextResponse.json({ groups: await preferencesFor(contact.id) });
});

export const OPTIONS = sdkOptions;
