"use client";

import { useState, useSyncExternalStore } from "react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type Status = "idle" | "unsupported" | "no-keys" | "subscribing" | "subscribed" | "error";

export default function PushDemoPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [detail, setDetail] = useState("");

  // Browser capability, read without a setState-in-effect (server render assumes supported)
  const supported = useSyncExternalStore(
    () => () => {},
    () => "serviceWorker" in navigator && "PushManager" in window,
    () => true
  );

  const subscribe = async () => {
    setStatus("subscribing");
    try {
      const keyRes = await fetch("/api/push/vapid-public-key");
      if (!keyRes.ok) { setStatus("no-keys"); return; }
      const { publicKey } = await keyRes.json();

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      // Once API keys exist, pass an SDK key: /demo/push?key=dk_pub_…
      const apiKey = new URLSearchParams(window.location.search).get("key");
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ email, subscription: sub.toJSON() }),
      });
      if (!res.ok) throw new Error(JSON.stringify(await res.json()));
      setStatus("subscribed");
    } catch (e) {
      setStatus("error");
      setDetail(String(e));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="card p-8 max-w-md w-full rise">
        <div className="figure text-[11px] uppercase tracking-[0.25em] text-accent mb-2">Dispatch · demo</div>
        <h1 className="text-3xl mb-3">Subscribe this browser to push</h1>
        <p className="text-sm text-ink-soft mb-6">
          Enter the email of a contact (created if new), allow notifications, and this browser becomes a
          reachable <span className="figure text-xs">WEB_PUSH</span> subscription in the console.
        </p>

        {!supported || status === "unsupported" ? (
          <div className="text-accent text-sm">This browser doesn&apos;t support web push.</div>
        ) : status === "subscribed" ? (
          <div className="bg-good-wash text-good p-4 text-sm">
            ✓ Subscribed. Send a test from the Templates page, or launch a WEB_PUSH campaign.
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="email"
              className="w-full border border-line-strong px-3 py-2.5 text-sm focus:outline-none focus:border-accent"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              onClick={subscribe}
              disabled={!email.includes("@") || status === "subscribing"}
              className="w-full bg-ink text-paper py-2.5 text-sm font-medium hover:bg-accent-deep transition-colors disabled:opacity-40"
            >
              {status === "subscribing" ? "Waiting for permission…" : "Enable notifications"}
            </button>
            {status === "no-keys" && (
              <div className="text-amber text-xs">VAPID keys missing — generate them on the Settings page first.</div>
            )}
            {status === "error" && <div className="text-accent text-xs break-all">{detail}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
