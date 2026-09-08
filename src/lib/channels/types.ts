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
  pushUrl?: string; // already click-tracking-wrapped
  subscription?: { endpoint: string; keys?: { p256dh: string; auth: string } | null };
  // webhook
  webhookUrl?: string;
  webhookBody?: string;
}

export type SendResult =
  | { ok: true; providerMessageId?: string; delivered?: boolean }
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
}
