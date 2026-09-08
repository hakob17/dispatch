"use client";

import { use, useEffect, useState } from "react";

interface Prefs {
  email: string | null;
  globallyUnsubscribed: boolean;
  groups: { id: string; name: string; description: string | null; subscribed: boolean }[];
}

/** Contact-facing email preference center (reached from every email footer). */
export default function PreferenceCenterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [err, setErr] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/u/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPrefs)
      .catch(() => setErr(true));
  }, [token]);

  const save = async (next: Prefs) => {
    setBusy(true);
    setSaved(false);
    const res = await fetch(`/api/u/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        globallyUnsubscribed: next.globallyUnsubscribed,
        groups: Object.fromEntries(next.groups.map((g) => [g.id, g.subscribed])),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setPrefs(next);
      setSaved(true);
    }
  };

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="card p-8 max-w-md w-full text-center rise">
          <h1 className="text-2xl">Invalid or expired link</h1>
        </div>
      </div>
    );
  }
  if (!prefs) return null;

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
      <div className="card p-8 max-w-md w-full rise">
        <div className="figure text-[11px] uppercase tracking-[0.25em] text-accent mb-2">Email preferences</div>
        <h1 className="text-3xl mb-1">Manage your subscriptions</h1>
        {prefs.email && <p className="figure text-xs text-ink-faint mb-6">{prefs.email}</p>}

        {prefs.groups.length > 0 && (
          <div className="space-y-3 mb-6">
            {prefs.groups.map((g) => (
              <label key={g.id} className={`flex items-start gap-3 p-3 border cursor-pointer ${prefs.globallyUnsubscribed ? "opacity-40" : ""} ${g.subscribed ? "border-line-strong" : "border-line bg-paper-sunken/40"}`}>
                <input
                  type="checkbox"
                  className="mt-1 accent-[#e8482b]"
                  disabled={prefs.globallyUnsubscribed}
                  checked={g.subscribed}
                  onChange={(e) =>
                    setPrefs({
                      ...prefs,
                      groups: prefs.groups.map((x) => (x.id === g.id ? { ...x, subscribed: e.target.checked } : x)),
                    })
                  }
                />
                <span>
                  <span className="text-sm font-medium block">{g.name}</span>
                  {g.description && <span className="text-xs text-ink-soft">{g.description}</span>}
                </span>
              </label>
            ))}
          </div>
        )}

        <label className="flex items-center gap-3 p-3 border border-accent/40 bg-accent-wash/40 cursor-pointer mb-6">
          <input
            type="checkbox"
            className="accent-[#e8482b]"
            checked={prefs.globallyUnsubscribed}
            onChange={(e) => setPrefs({ ...prefs, globallyUnsubscribed: e.target.checked })}
          />
          <span className="text-sm">Unsubscribe from <strong>all</strong> emails</span>
        </label>

        <button
          onClick={() => save(prefs)}
          disabled={busy}
          className="w-full bg-ink text-paper py-2.5 text-sm font-medium hover:bg-accent-deep transition-colors disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save preferences"}
        </button>
        {saved && <div className="text-good text-sm text-center mt-3">✓ Preferences saved</div>}
      </div>
    </div>
  );
}
