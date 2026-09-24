import { NextResponse } from "next/server";
import { z } from "zod";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { hasIdentity, resolveContact } from "@/lib/identity";
import { ingestEvents } from "@/lib/events";

const schema = identitySchema.extend({
  events: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        properties: z.record(z.string(), z.unknown()).optional(),
        timestamp: z.string().datetime({ offset: true }).optional(),
      })
    )
    .min(1)
    .max(100),
});

/** Batched custom events (the SDK queues and flushes them). Fires event-triggered campaigns. */
export const POST = sdkRoute("/api/sdk/v1/events", schema, async ({ body }) => {
  if (!hasIdentity(body)) return NextResponse.json({ error: "anonymousId or externalId required" }, { status: 400 });
  const contact = await resolveContact(body);
  if (!contact) return NextResponse.json({ error: "could not resolve contact" }, { status: 400 });
  const res = await ingestEvents(contact.id, body.events);
  return NextResponse.json({ ok: true, accepted: res.eventIds.length, triggeredCampaigns: res.triggeredCampaigns }, { status: 202 });
});

export const OPTIONS = sdkOptions;
