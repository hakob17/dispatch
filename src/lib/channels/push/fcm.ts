import type { ChannelAdapter, RenderedMessage, SendResult } from "../types";
import { getFcmServiceAccount } from "../../settings";

// firebase-admin is imported lazily so the app runs fine without credentials.
type FcmApp = import("firebase-admin/app").App;
type FcmMessage = import("firebase-admin/messaging").TokenMessage;
let app: FcmApp | null = null;
let appKey = "";

async function getApp(): Promise<FcmApp | null> {
  const sa = await getFcmServiceAccount();
  if (!sa) return null;
  const key = `${sa.project_id}:${sa.private_key_id}`;
  if (app && appKey === key) return app;
  try {
    const { initializeApp, cert, deleteApp } = await import("firebase-admin/app");
    if (app) await deleteApp(app).catch(() => {});
    // Named app so credential changes from the Settings page take effect without a restart
    app = initializeApp({ credential: cert(sa as never) }, `dispatch-${Date.now()}`);
    appKey = key;
    return app;
  } catch (err) {
    console.error("[fcm] init failed:", err);
    return null;
  }
}

/** Errors that mean the token will never work again — deactivate it so it stops using throughput. */
const DEAD_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
const TRANSIENT_ERRORS = new Set([
  "messaging/unavailable",
  "messaging/internal-error",
  "messaging/server-unavailable",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
  "messaging/quota-exceeded",
  // Credential/config problems are ours, not the token's: retry so a fixed
  // service account recovers the send instead of failing it for good
  "app/invalid-credential",
  "messaging/authentication-error",
]);

/** Build the FCM v1 message, mapping our push options onto Android, APNs (iOS via FCM) and web push. */
export function buildFcmMessage(msg: RenderedMessage): FcmMessage {
  const o = msg.push ?? { priority: "HIGH" as const };
  const high = o.priority === "HIGH";
  const data: Record<string, string> = {
    ...(o.data ?? {}),
    url: msg.pushUrl || "/",
    messageId: msg.messageId,
    priority: o.priority,
    ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
    ...(o.collapseKey ? { collapseKey: o.collapseKey } : {}),
  };
  // The native Android SDK creates these channels; apps without it fall back to FCM's default channel
  const channelId = o.data?.androidChannelId ?? (high ? "dispatch_breaking" : "dispatch_default");
  const apnsHeaders: Record<string, string> = {
    "apns-priority": high ? "10" : "5",
    "apns-push-type": "alert",
  };
  if (o.collapseKey) apnsHeaders["apns-collapse-id"] = o.collapseKey.slice(0, 64);
  if (o.ttlSeconds !== undefined) apnsHeaders["apns-expiration"] = String(Math.floor(Date.now() / 1000) + o.ttlSeconds);

  return {
    token: msg.subscription!.endpoint,
    notification: {
      title: msg.pushTitle || "",
      body: msg.pushBody || "",
      ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
    },
    data,
    android: {
      priority: high ? "high" : "normal",
      ...(o.collapseKey ? { collapseKey: o.collapseKey } : {}),
      ...(o.ttlSeconds !== undefined ? { ttl: o.ttlSeconds * 1000 } : {}),
      notification: {
        channelId,
        ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
        ...(o.collapseKey ? { tag: o.collapseKey } : {}),
      },
    },
    apns: {
      headers: apnsHeaders,
      payload: { aps: { sound: "default", ...(o.imageUrl ? { mutableContent: true } : {}) } },
      ...(o.imageUrl ? { fcmOptions: { imageUrl: o.imageUrl } } : {}),
    },
  };
}

function toResult(err: { code?: string; message?: string }): SendResult {
  const dead = !!err.code && DEAD_TOKEN_ERRORS.has(err.code);
  const transient = !!err.code && TRANSIENT_ERRORS.has(err.code);
  return {
    ok: false,
    error: `${err.code ?? "fcm-error"}: ${err.message ?? ""}`.slice(0, 500),
    permanent: !transient,
    deactivateSubscription: dead,
  };
}

export const fcmAdapter: ChannelAdapter = {
  channel: "FCM",
  configHint: "Upload a Firebase service-account JSON on the Settings page (or set FCM_SERVICE_ACCOUNT_JSON)",
  async isConfigured() {
    return !!(await getApp());
  },
  async send(msg) {
    return (await this.sendBatch!([msg]))[0];
  },
  /** FCM sendEach: up to 500 messages per call, fanned out over HTTP/2 by firebase-admin. */
  async sendBatch(msgs) {
    const fcmApp = await getApp();
    if (!fcmApp) return msgs.map(() => ({ ok: false, error: "FCM not configured", permanent: true }));

    const results: SendResult[] = new Array(msgs.length);
    const sendable: { i: number; m: FcmMessage }[] = [];
    msgs.forEach((msg, i) => {
      if (!msg.subscription?.endpoint) results[i] = { ok: false, error: "missing FCM token", permanent: true };
      else sendable.push({ i, m: buildFcmMessage(msg) });
    });

    const { getMessaging } = await import("firebase-admin/messaging");
    for (let start = 0; start < sendable.length; start += 500) {
      const chunk = sendable.slice(start, start + 500);
      try {
        const res = await getMessaging(fcmApp).sendEach(chunk.map((c) => c.m));
        res.responses.forEach((r, j) => {
          results[chunk[j].i] = r.success
            ? { ok: true, providerMessageId: r.messageId }
            : toResult(r.error as { code?: string; message?: string });
        });
      } catch (err) {
        // Whole-call failure (auth, network): everything in the chunk is retryable
        const e = err as { code?: string; message?: string };
        for (const c of chunk) results[c.i] = { ok: false, error: `fcm-batch: ${e.code ?? ""} ${e.message ?? ""}`.slice(0, 500), permanent: false };
      }
    }
    return results;
  },
};

/**
 * Send pre-built FCM messages (e.g. data-only Live Updates) in sendEach chunks.
 * Returns one result per message.
 */
export async function fcmSendRaw(messages: FcmMessage[]): Promise<{ ok: boolean; deactivate?: boolean; error?: string }[]> {
  const fcmApp = await getApp();
  if (!fcmApp) return messages.map(() => ({ ok: false, error: "FCM not configured" }));
  const { getMessaging } = await import("firebase-admin/messaging");
  const out: { ok: boolean; deactivate?: boolean; error?: string }[] = [];
  for (let i = 0; i < messages.length; i += 500) {
    const res = await getMessaging(fcmApp).sendEach(messages.slice(i, i + 500));
    for (const r of res.responses) {
      const code = (r.error as { code?: string } | undefined)?.code;
      out.push(r.success ? { ok: true } : { ok: false, deactivate: !!code && DEAD_TOKEN_ERRORS.has(code), error: code });
    }
  }
  return out;
}
