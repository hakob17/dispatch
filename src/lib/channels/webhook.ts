import type { ChannelAdapter, RenderedMessage, SendResult } from "./types";

/** Braze-style webhook channel: POST a templated JSON body to an arbitrary URL. */
export const webhookAdapter: ChannelAdapter = {
  channel: "WEBHOOK",
  configHint: "Always available — set the destination URL on the template",
  async isConfigured() {
    return true;
  },
  async send(msg: RenderedMessage): Promise<SendResult> {
    if (!msg.webhookUrl) return { ok: false, error: "missing webhook URL", permanent: true };
    try {
      const res = await fetch(msg.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: msg.webhookBody || "{}",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true, delivered: true };
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        permanent: res.status >= 400 && res.status < 500 && res.status !== 429,
      };
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 500), permanent: false };
    }
  },
};
