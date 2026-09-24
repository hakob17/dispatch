import { Channel } from "@prisma/client";

/** A fully rendered, per-recipient message ready for a provider. */
export interface RenderedMessage {
  messageId: string;
  channel: Channel;
  // email
  to?: string;
  subject?: string;
  html?: string;
  text?: string;
  unsubUrl?: string;
  // push
  pushTitle?: string;
  pushBody?: string;
  pushUrl?: string; // web push: click-tracking-wrapped; mobile: raw deep link (opens tracked by the SDK)
  push?: PushOptions;
  subscription?: { endpoint: string; keys?: { p256dh: string; auth: string } | null };
  // in-app / message centre
  inApp?: InAppContent;
  // content card feed
  card?: CardContent;
  // SMS / WhatsApp (`to` = the contact's phone number)
  smsBody?: string;
  whatsappContentSid?: string;
  whatsappVariables?: Record<string, string>;
  // webhook
  webhookUrl?: string;
  webhookBody?: string;
}

/** What the SDK receives for an in-app / message-centre message. */
export interface InAppContent {
  layout: "MODAL" | "BANNER" | "FULLSCREEN" | "INBOX";
  title: string;
  body: string;
  imageUrl: string | null;
  buttons: { label: string; url: string }[];
  /** deep link for tapping the message itself */
  url: string | null;
}

/** What the SDK receives for a content card. */
export interface CardContent {
  style: "CLASSIC" | "CAPTIONED_IMAGE" | "BANNER";
  title: string;
  body: string;
  imageUrl: string | null;
  /** tapping the card (and its button) opens this */
  url: string | null;
  buttonLabel: string | null;
  pinned: boolean;
  dismissible: boolean;
  category: string | null;
}

/** Delivery settings shared by every push provider. */
export interface PushOptions {
  priority: "HIGH" | "NORMAL"; // HIGH wakes the device immediately (breaking news)
  collapseKey?: string; // replaces an earlier notification with the same key
  ttlSeconds?: number; // drop if not delivered in time (stale alerts)
  imageUrl?: string; // rich media — no vendor code needed in the app extension
  data?: Record<string, string>; // extra key/values delivered to the app
}

export type SendResult =
  | { ok: true; providerMessageId?: string; delivered?: boolean; content?: InAppContent | CardContent }
  | {
      ok: false;
      error: string;
      /** true = do not retry (bad address, rejected content) */
      permanent: boolean;
      /** true = the push subscription/token is dead and should be deactivated */
      deactivateSubscription?: boolean;
    };

export interface ChannelAdapter {
  channel: Channel;
  isConfigured(): Promise<boolean>;
  /** Human hint shown in the UI when not configured. */
  configHint: string;
  send(msg: RenderedMessage): Promise<SendResult>;
  /**
   * Optional provider batch send (e.g. FCM sendEach, 500 per call).
   * Must return one result per input, in the same order.
   */
  sendBatch?(msgs: RenderedMessage[]): Promise<SendResult[]>;
}
