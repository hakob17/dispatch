import { Channel } from "@prisma/client";
import type { ChannelAdapter } from "./types";
import { sesAdapter } from "./email/ses";
import { webPushAdapter } from "./push/webPush";
import { fcmAdapter } from "./push/fcm";
import { apnsAdapter } from "./push/apns";
import { contentCardAdapter, inAppAdapter } from "./inApp";
import { webhookAdapter } from "./webhook";
import { smsAdapter, whatsappAdapter } from "./sms/twilio";
import { mockAdapter, mockEnabled } from "./mock";

const adapters: Record<Channel, ChannelAdapter> = {
  EMAIL: sesAdapter,
  WEB_PUSH: webPushAdapter,
  FCM: fcmAdapter,
  APNS: apnsAdapter,
  WEBHOOK: webhookAdapter,
  IN_APP: inAppAdapter,
  CONTENT_CARD: contentCardAdapter,
  SMS: smsAdapter,
  WHATSAPP: whatsappAdapter,
};

/** Channels the mock provider stands in for (PUSH_PROVIDER_MODE=mock: load tests, demos, CI). */
const MOCKABLE: Channel[] = ["FCM", "APNS", "WEB_PUSH", "SMS", "WHATSAPP"];

export function getAdapter(channel: Channel): ChannelAdapter {
  if (MOCKABLE.includes(channel) && mockEnabled()) return mockAdapter(adapters[channel]);
  return adapters[channel];
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "Email",
  WEB_PUSH: "Web Push",
  FCM: "Mobile Push (FCM)",
  APNS: "iOS Push (APNs)",
  WEBHOOK: "Webhook",
  IN_APP: "In-app / message centre",
  CONTENT_CARD: "Content cards",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

export async function getChannelStatus(): Promise<
  { channel: Channel; label: string; configured: boolean; hint: string }[]
> {
  return Promise.all(
    (Object.keys(adapters) as Channel[]).map(async (channel) => ({
      channel,
      label: CHANNEL_LABELS[channel],
      configured: await adapters[channel].isConfigured(),
      hint: adapters[channel].configHint,
    }))
  );
}
