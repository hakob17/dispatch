"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/bootstrap").then((r) => r.json()).then((j) => setBootstrap(j.needed));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const url = bootstrap ? "/api/auth/bootstrap" : "/api/auth/login";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bootstrap ? { email, password, name } : { email, password }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setErr((await res.json()).error ?? "failed");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="card p-8 max-w-sm w-full rise">
        <div className="font-display text-3xl tracking-tight mb-1">
          Dispatch<span className="text-accent">.</span>
        </div>
        <div className="figure text-[10px] uppercase tracking-[0.25em] text-ink-faint mb-6">
          {bootstrap ? "first-run setup" : "engagement console"}
        </div>

        {bootstrap && (
          <>
            <p className="text-sm text-ink-soft mb-4">
              No accounts exist yet. Create the first <strong>admin</strong> account.
            </p>
            <input
              className="w-full border border-line-strong px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-accent"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        )}

        <input
          type="email"
          required
          className="w-full border border-line-strong px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-accent"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={bootstrap ? 8 : undefined}
          className="w-full border border-line-strong px-3 py-2.5 text-sm mb-4 focus:outline-none focus:border-accent"
          placeholder={bootstrap ? "password (8+ characters)" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {err && <div className="text-accent text-sm mb-3">{err}</div>}

        <button
          type="submit"
          disabled={busy || bootstrap === null}
          className="w-full bg-ink text-paper py-2.5 text-sm font-medium hover:bg-accent-deep transition-colors disabled:opacity-40"
        >
          {busy ? "…" : bootstrap ? "Create admin account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
