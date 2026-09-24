import { NextResponse } from "next/server";
import { identitySchema, sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { findContact } from "@/lib/identity";
import { recommendForContacts } from "@/lib/recommend";
import { publicRec, recoQuery } from "@/lib/recoApi";

/** "For you" / trending / latest articles for this device's user. Unknown users get the non-personal ranking. */
export const GET = sdkRoute("/api/sdk/v1/recommendations", identitySchema.merge(recoQuery), async ({ body }) => {
  const contact = await findContact(body);
  const key = contact?.id ?? "anonymous";
  const recs = await recommendForContacts([{ id: key, language: contact?.language }], body);
  return NextResponse.json({ strategy: body.strategy, items: (recs.get(key) ?? []).map(publicRec) });
});

export const OPTIONS = sdkOptions;
