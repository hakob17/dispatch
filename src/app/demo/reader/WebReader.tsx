"use client";
/* eslint-disable @next/next/no-img-element -- demo page: remote article images, no optimiser needed */

import { useEffect, useMemo, useState } from "react";
import {
  DispatchClient,
  DispatchProvider,
  useContentCards,
  useDispatch,
  usePreferences,
  useRecommendations,
} from "../../../../packages/react-sdk/dist/index.js";
import { DispatchInAppMessage, onWebPushReceived, registerWebPush } from "../../../../packages/react-sdk/dist/web.js";

const ACCENT = "#bf3218";
/** The web reader subscribes to its own newsletter pair, like the three mobile demos. */
const NEWSLETTERS = ["markets-daily", "tech-weekly"];

export default function WebReader({ sdkKey, baseUrl }: { sdkKey: string; baseUrl: string }) {
  const client = useMemo(() => new DispatchClient({ apiKey: sdkKey, baseUrl, platform: "web", appVersion: "demo-web-1.0", deviceId: "demo-web-browser", flushIntervalMs: 3000 }), [sdkKey, baseUrl]);
  return (
    <DispatchProvider client={client}>
      <Reader />
      <DispatchInAppMessage pollMs={4000} accentColor={ACCENT} onNavigate={(url) => console.log("open", url)} />
    </DispatchProvider>
  );
}

type Received = { at: string; title: string; body: string };

function Reader() {
  const dispatch = useDispatch();
  const [who, setWho] = useState<string | null>(null);
  const [push, setPush] = useState<string>("not enabled");
  const [note, setNote] = useState<string | null>(null);
  const [received, setReceived] = useState<Received[]>([]);
  const { cards, markViewed, click, dismiss } = useContentCards({ pollMs: 5000 });
  const { items } = useRecommendations({ strategy: "for_you", limit: 5 });
  const { groups, setSubscribed, reload } = usePreferences();

  useEffect(() => {
    void dispatch.init().then(() => setWho(dispatch.getExternalId()));
    return onWebPushReceived((p) => setReceived((r) => [{ at: new Date().toLocaleTimeString(), title: p.title, body: p.body }, ...r].slice(0, 8)));
  }, [dispatch]);
  useEffect(() => markViewed(cards.map((c) => c.id)), [cards, markViewed]);

  const signIn = async () => {
    await dispatch.identify("demo-reader-web", { firstName: "Sam" });
    await dispatch.setPreferences(Object.fromEntries(NEWSLETTERS.map((n) => [n, true])));
    setWho("demo-reader-web");
    await reload();
  };
  const enablePush = async () => {
    const r = await registerWebPush(dispatch, { serviceWorkerUrl: "/dispatch-sw.js" });
    setPush(r.status === "subscribed" ? "enabled — this browser gets Dispatch pushes" : `not enabled (${r.status})`);
  };

  return (
    <main style={{ fontFamily: "system-ui, -apple-system, sans-serif", maxWidth: 1040, margin: "0 auto", padding: "28px 24px", color: "#17130e", background: "#faf7f2", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Dispatch News <span style={{ fontSize: 14, color: "#6f6656", fontWeight: 400 }}>web reader · React SDK</span></h1>
        <div style={{ display: "flex", gap: 8 }}>
          {who ? <span style={{ fontSize: 14 }}>Signed in as <b>{who}</b></span> : <button onClick={signIn} style={btn}>Sign in as demo-reader-web</button>}
          <button onClick={() => { dispatch.track("election_followed"); void dispatch.flush(); setNote("Sent event: election_followed"); }} style={btn}>Follow election night</button>
          <button onClick={enablePush} style={{ ...btn, background: "white", color: ACCENT }}>Enable web push</button>
        </div>
      </header>
      <p style={{ fontSize: 13, color: "#6f6656", marginTop: -8 }}>Web push: {push}{note && <b style={{ color: ACCENT, marginLeft: 12 }}>{note}</b>}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 24 }}>
        <section>
          <h2 style={h2}>Cards</h2>
          {!cards.length && <p style={muted}>No cards yet.</p>}
          {cards.map((c) => (
            <div key={c.id} onClick={() => click(c)} style={{ background: "white", border: "1px solid #e3dcce", borderRadius: 12, overflow: "hidden", marginBottom: 12, position: "relative", cursor: "pointer" }}>
              {c.style !== "CLASSIC" && c.imageUrl && <img src={c.imageUrl} alt="" style={{ width: "100%", height: 150, objectFit: "cover", display: "block" }} />}
              <div style={{ padding: 14, display: "flex", gap: 12 }}>
                {c.style === "CLASSIC" && c.imageUrl && <img src={c.imageUrl} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6 }} />}
                <div>
                  <div style={{ fontWeight: 600 }}>{c.title}</div>
                  <div style={muted}>{c.body}</div>
                  {c.buttonLabel && <div style={{ color: ACCENT, fontWeight: 600, fontSize: 14, marginTop: 4 }}>{c.buttonLabel} →</div>}
                </div>
              </div>
              <div style={{ position: "absolute", top: 8, right: 10 }}>
                {c.pinned && <span title="Pinned">📌</span>}
                {c.dismissible && <button aria-label="Dismiss card" onClick={(e) => { e.stopPropagation(); void dismiss(c); }} style={{ border: 0, background: "white", borderRadius: 12, cursor: "pointer", marginLeft: 6 }}>✕</button>}
              </div>
            </div>
          ))}
          <h2 style={h2}>For you</h2>
          {items.map((i) => (
            <div key={i.id} onClick={() => { dispatch.articleRead(i.id); void dispatch.flush(); setNote(`Sent event: article_read (${i.title})`); }} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #e3dcce", cursor: "pointer" }}>
              {i.imageUrl ? <img src={i.imageUrl} alt="" style={{ width: 72, height: 50, objectFit: "cover", borderRadius: 6 }} /> : <div style={{ width: 72, height: 50, background: "#eee", borderRadius: 6 }} />}
              <div><div style={{ color: ACCENT, fontSize: 11, fontWeight: 700 }}>{(i.section ?? "news").toUpperCase()}</div><div style={{ fontWeight: 600, fontSize: 15 }}>{i.title}</div></div>
            </div>
          ))}
        </section>
        <aside>
          <h2 style={h2}>Pushes received in this browser</h2>
          {!received.length && <p style={muted}>Waiting for a push…</p>}
          {received.map((r, i) => (
            <div key={i} style={{ background: "white", border: `1px solid ${i === 0 ? ACCENT : "#e3dcce"}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "#6f6656" }}>{r.at}</div>
              <div style={{ fontWeight: 600 }}>{r.title}</div>
              <div style={muted}>{r.body}</div>
            </div>
          ))}
          <h2 style={h2}>Newsletters & topics</h2>
          {(groups ?? []).map((g) => (
            <label key={g.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
              <span>{g.name} <span style={{ color: "#6f6656", fontSize: 12 }}>{g.kind}</span></span>
              <input type="checkbox" checked={g.subscribed} onChange={(e) => void setSubscribed(g.id, e.target.checked)} />
            </label>
          ))}
        </aside>
      </div>
    </main>
  );
}

const btn: React.CSSProperties = { background: ACCENT, color: "white", border: `1px solid ${ACCENT}`, borderRadius: 18, padding: "8px 16px", fontWeight: 600, cursor: "pointer" };
const h2: React.CSSProperties = { fontSize: 13, textTransform: "uppercase", letterSpacing: "0.12em", color: ACCENT, margin: "18px 0 10px" };
const muted: React.CSSProperties = { color: "#6f6656", fontSize: 14 };
