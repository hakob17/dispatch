import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/apiAuth";
import { ingestEvents } from "@/lib/events";
import { resolveContact } from "@/lib/identity";

const trackSchema = z.object({
  email: z.string().email().optional(),
  contactId: z.string().optional(),
  externalId: z.string().min(1).optional(),
  event: z.string().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Braze-style custom event tracking.
 * POST { externalId | email | contactId, event, properties? }
 * Creates the contact if the email is unknown, fires event-triggered
 * campaigns, and attributes conversions.
 */
export async function POST(req: NextRequest) {
  const denied = await requireApiKey(req, "/api/track");
  if (denied) return denied;

  const body = trackSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { email, contactId, externalId, event, properties } = body.data;

  const contact = await resolveContact({ contactId, externalId, email });
  if (!contact) return NextResponse.json({ error: "contact not found" }, { status: 404 });

  const res = await ingestEvents(contact.id, [{ name: event, properties }]);
  return NextResponse.json(
    { ok: true, eventId: res.eventIds[0], triggeredCampaigns: res.triggeredCampaigns, conversions: res.conversions },
    { status: 201 }
  );
}

