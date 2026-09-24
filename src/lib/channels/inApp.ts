import type { ChannelAdapter, SendResult } from "./types";

/**
 * In-app / message centre. Nothing leaves the building: "sending" stores the
 * rendered content on the Message, and the SDK pulls it (GET /api/sdk/v1/inbox).
 * Fetching marks it delivered, showing it marks it opened, a button tap is a click.
 * Works for users who never granted push permission.
 */
export const inAppAdapter: ChannelAdapter = {
  channel: "IN_APP",
  configHint: "Always available — apps fetch messages through the SDK",
  isConfigured: async () => true,
  async send(msg) {
    return (await this.sendBatch!([msg]))[0];
  },
  async sendBatch(msgs) {
    return msgs.map(
      (m): SendResult => (m.inApp ? { ok: true, content: m.inApp } : { ok: false, error: "nothing to show", permanent: true })
    );
  },
};

/**
 * Content cards: like in-app messages, stored on the Message and pulled by the SDK
 * (GET /api/sdk/v1/cards). They stay in the feed until they expire or the reader dismisses them.
 */
export const contentCardAdapter: ChannelAdapter = {
  channel: "CONTENT_CARD",
  configHint: "Always available — apps fetch cards through the SDK",
  isConfigured: async () => true,
  async send(msg) {
    return (await this.sendBatch!([msg]))[0];
  },
  async sendBatch(msgs) {
    return msgs.map((m): SendResult => (m.card ? { ok: true, content: m.card } : { ok: false, error: "nothing to show", permanent: true }));
  },
};
