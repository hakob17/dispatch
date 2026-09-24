import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute, userToken } from "@/lib/sdkApi";

const schema = z.object({ externalId: z.string().min(1).max(255) });

/**
 * Mint the X-Dispatch-User-Token for a signed-in user. Your backend calls this
 * at login and hands the token to the app, which passes it to the SDK.
 * Required on SDK calls naming an externalId when SDK_REQUIRE_USER_TOKEN=true.
 */
export const POST = serverRoute("/api/v1/sdk-tokens", schema, async ({ body }) => {
  return NextResponse.json({ externalId: body.externalId, userToken: userToken(body.externalId) });
});
