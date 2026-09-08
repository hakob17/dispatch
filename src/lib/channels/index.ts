import { Channel } from "@prisma/client";
import type { ChannelAdapter } from "./types";
import { sesAdapter } from "./email/ses";
import { webPushAdapter } from "./push/webPush";
import { fcmAdapter } from "./push/fcm";
import { webhookAdapter } from "./webhook";

/** Stub adapter for channels that need a paid provider account (Twilio etc.). */
function stub(channel: Channel, hint: string): ChannelAdapter {
  return {
    channel,
    configHint: hint,
    isConfigured: async () => false,
    send: async () => ({ ok: false, error: `${channel} not configured`, permanent: true }),
  };
}

const adapters: Record<Channel, ChannelAdapter> = {
  EMAIL: sesAdapter,
  WEB_PUSH: webPushAdapter,
  FCM: fcmAdapter,
  APNS: stub("APNS", "Direct APNs requires an Apple Developer account — use FCM for iOS instead"),
  WEBHOOK: webhookAdapter,
  SMS: stub("SMS", "SMS requires a Twilio (or similar) account — not configured"),
  WHATSAPP: stub("WHATSAPP", "WhatsApp requires a Meta Business + Twilio account — not configured"),
};

export function getAdapter(channel: Channel): ChannelAdapter {
  return adapters[channel];
}

export const CHANNEL_LABELS: Record<Channel, string> = {
  EMAIL: "Email",
  WEB_PUSH: "Web Push",
  FCM: "Mobile Push (FCM)",
  APNS: "iOS Push (APNs)",
  WEBHOOK: "Webhook",
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
