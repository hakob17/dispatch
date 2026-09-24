import webpush from "web-push";
import { getVapidKeys } from "../../settings";
import type { ChannelAdapter, RenderedMessage, SendResult } from "../types";

export const webPushAdapter: ChannelAdapter = {
  channel: "WEB_PUSH",
  configHint: "Generate VAPID keys on the Settings page (or set VAPID_* env vars)",
  async isConfigured() {
    return !!(await getVapidKeys());
  },
  async send(msg: RenderedMessage): Promise<SendResult> {
    const keys = await getVapidKeys();
    if (!keys) return { ok: false, error: "VAPID keys not configured", permanent: true };
    if (!msg.subscription?.endpoint || !msg.subscription.keys) {
      return { ok: false, error: "missing web push subscription", permanent: true };
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: msg.subscription.endpoint,
          keys: msg.subscription.keys,
        },
        JSON.stringify({
          title: msg.pushTitle || "",
          body: msg.pushBody || "",
          url: msg.pushUrl || "/",
          messageId: msg.messageId,
          image: msg.push?.imageUrl,
          tag: msg.push?.collapseKey,
          data: msg.push?.data,
        }),
        {
          vapidDetails: {
            subject: keys.subject,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
          TTL: msg.push?.ttlSeconds ?? 24 * 3600,
          urgency: msg.push?.priority === "NORMAL" ? "normal" : "high",
          // Push-service-level collapse: Topic must be ≤32 URL-safe base64 chars
          ...(msg.push?.collapseKey
            ? { topic: Buffer.from(msg.push.collapseKey).toString("base64url").slice(0, 32) }
            : {}),
        }
      );
      // Web push has no delivery receipts — a 201 from the push service is as
      // close to "delivered" as it gets.
      return { ok: true, delivered: true };
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      const gone = e.statusCode === 404 || e.statusCode === 410;
      return {
        ok: false,
        error: `webpush ${e.statusCode ?? ""}: ${e.message ?? ""}`.slice(0, 500),
        permanent: gone || (e.statusCode !== undefined && e.statusCode < 500 && e.statusCode !== 429),
        deactivateSubscription: gone,
      };
    }
  },
};
