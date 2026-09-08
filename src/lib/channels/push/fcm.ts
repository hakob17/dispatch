import type { ChannelAdapter, RenderedMessage, SendResult } from "../types";
import { getFcmServiceAccount } from "../../settings";

// firebase-admin is imported lazily so the app runs fine without credentials.
type FcmApp = import("firebase-admin/app").App;
let app: FcmApp | null = null;
let initFailed = false;

async function getApp(): Promise<FcmApp | null> {
  if (app) return app;
  if (initFailed) return null;
  const sa = await getFcmServiceAccount();
  if (!sa) return null;
  try {
    const { initializeApp, cert, getApps } = await import("firebase-admin/app");
    const existing = getApps();
    app = existing.length ? existing[0] : initializeApp({ credential: cert(sa as never) });
    return app;
  } catch {
    initFailed = true;
    return null;
  }
}

const DEAD_TOKEN_ERRORS = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export const fcmAdapter: ChannelAdapter = {
  channel: "FCM",
  configHint: "Upload a Firebase service-account JSON on the Settings page (or set FCM_SERVICE_ACCOUNT_PATH)",
  async isConfigured() {
    return !!(await getApp());
  },
  async send(msg: RenderedMessage): Promise<SendResult> {
    const fcmApp = await getApp();
    if (!fcmApp) return { ok: false, error: "FCM not configured", permanent: true };
    if (!msg.subscription?.endpoint) {
      return { ok: false, error: "missing FCM token", permanent: true };
    }
    try {
      const { getMessaging } = await import("firebase-admin/messaging");
      const id = await getMessaging(fcmApp).send({
        token: msg.subscription.endpoint,
        notification: { title: msg.pushTitle || "", body: msg.pushBody || "" },
        data: { url: msg.pushUrl || "/", messageId: msg.messageId },
      });
      return { ok: true, providerMessageId: id };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const dead = !!e.code && DEAD_TOKEN_ERRORS.has(e.code);
      const transient = e.code === "messaging/unavailable" || e.code === "messaging/internal-error";
      return {
        ok: false,
        error: `${e.code ?? "fcm-error"}: ${e.message ?? ""}`.slice(0, 500),
        permanent: !transient,
        deactivateSubscription: dead,
      };
    }
  },
};
