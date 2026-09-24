export { DispatchInAppMessage } from "./web-ui.js";
import type { DispatchClient } from "./client.js";

export interface WebPushOptions {
  /**
   * Where the service worker is served from your site (copy
   * node_modules/@dispatch/react-sdk/sw/dispatch-sw.js to your public dir).
   * Must be same-origin; its scope decides which pages it controls.
   */
  serviceWorkerUrl?: string;
}

export type WebPushResult =
  | { status: "subscribed"; subscription: PushSubscriptionJSON }
  | { status: "unsupported" | "denied" | "not-configured" };

/**
 * Browser web push. Call from a user gesture (e.g. a "Get alerts" button) —
 * browsers block permission prompts that aren't user-initiated.
 * Works in Chrome, Edge, Firefox and Safari 16.4+ (iOS/iPadOS: only for web
 * apps added to the Home Screen).
 */
export async function registerWebPush(client: DispatchClient, opts: WebPushOptions = {}): Promise<WebPushResult> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { status: "unsupported" };
  }
  const { webPush } = await client.getConfig();
  if (!webPush) return { status: "not-configured" };

  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { status: "denied" };

  const cfg = client.getEndpoint();
  const swUrl = `${opts.serviceWorkerUrl ?? "/dispatch-sw.js"}?${new URLSearchParams({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl })}`;
  const reg = await navigator.serviceWorker.register(swUrl);
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(webPush.vapidPublicKey) as BufferSource,
    }));
  const json = subscription.toJSON();
  await client.registerWebPushSubscription(json);
  return { status: "subscribed", subscription: json };
}

export async function unregisterWebPush(client: DispatchClient): Promise<void> {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  }
  await client.unregisterPushToken();
}

function base64UrlToBytes(b64: string): Uint8Array {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Call `handler` whenever a Dispatch web push arrives while this page is open (the service
 * worker still shows the system notification). Returns an unsubscribe function.
 */
export function onWebPushReceived(handler: (push: { title: string; body: string; url?: string | null; messageId?: string | null; image?: string | null }) => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const listener = (e: MessageEvent) => {
    if (e.data?.type === "dispatch:push") handler(e.data.push);
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
