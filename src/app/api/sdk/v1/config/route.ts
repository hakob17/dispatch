import { NextResponse } from "next/server";
import { sdkOptions, sdkRoute } from "@/lib/sdkApi";
import { getVapidKeys } from "@/lib/settings";

/** Client bootstrap config (web push VAPID public key). */
export const GET = sdkRoute("/api/sdk/v1/config", null, async () => {
  const vapid = await getVapidKeys();
  return NextResponse.json({ webPush: vapid ? { vapidPublicKey: vapid.publicKey } : null });
});

export const OPTIONS = sdkOptions;
