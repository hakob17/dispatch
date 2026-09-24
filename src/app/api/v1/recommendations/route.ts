import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { findContact } from "@/lib/identity";
import { recommendForContacts } from "@/lib/recommend";
import { publicRec, recoQuery } from "@/lib/recoApi";

const schema = recoQuery.extend({ externalId: z.string().optional(), email: z.string().email().optional() });

/** Recommendations for a user (or non-personal trending/latest when no user is given) — for your site/app backend. */
export const GET = serverRoute("/api/v1/recommendations", schema, async ({ body }) => {
  const contact = body.externalId || body.email ? await findContact(body) : null;
  if ((body.externalId || body.email) && !contact && body.strategy === "for_you") {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const key = contact?.id ?? "anonymous";
  const recs = await recommendForContacts([{ id: key, language: contact?.language }], body);
  return NextResponse.json({ strategy: body.strategy, items: (recs.get(key) ?? []).map(publicRec) });
});
