"use client";

import { useState } from "react";
import useFetch from "@/lib/useFetch";
import { Badge, Button, Card, Field, PageHeader, inputCls } from "@/components/ui";

interface Me {
  email: string;
  role: "ADMIN" | "USER";
  mfaEnabled: boolean;
  sso: boolean;
  recoveryCodesLeft: number;
}

export default function AccountPage() {
  const { data: me, refresh } = useFetch<Me>("/api/auth/me");
  if (!me) return null;
  return (
    <div>
      <PageHeader kicker="Your account" title={me.email} />
      <div className="space-y-6 max-w-2xl">
        <Card className="rise">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl">Two-step verification</h2>
            <Badge tone={me.mfaEnabled ? "COMPLETED" : "DRAFT"}>{me.mfaEnabled ? "on" : "off"}</Badge>
          </div>
          <p className="text-sm text-ink-soft mb-4">
            {me.sso
              ? "You sign in through your company's single sign-on, which applies its own verification. This setting covers password sign-in."
              : "Ask for a code from an authenticator app whenever you sign in with your password."}
          </p>
          {me.mfaEnabled ? <Disable onDone={refresh} left={me.recoveryCodesLeft} /> : <Enable onDone={refresh} />}
        </Card>
        <Card className="rise rise-2">
          <h2 className="text-xl mb-1">Sessions</h2>
          <p className="text-sm text-ink-soft mb-4">Signed in on a shared or lost device? Sign out of every browser at once, including this one.</p>
          <Button
            variant="danger"
            onClick={async () => {
              await fetch("/api/auth/sessions", { method: "DELETE" });
              window.location.href = "/login";
            }}
          >
            Sign out everywhere
          </Button>
        </Card>
      </div>
    </div>
  );
}

function Enable({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const start = async () => {
    setErr(null);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const json = await res.json();
    if (!res.ok) return setErr(json.error);
    setSetup(json);
  };
  const confirm = async () => {
    setErr(null);
    const res = await fetch("/api/auth/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    if (!res.ok) return setErr(json.error);
    setCodes(json.recoveryCodes);
  };

  if (codes) {
    return (
      <div>
        <div className="figure text-[11px] uppercase tracking-wider text-amber mb-2">Recovery codes — shown only once</div>
        <div className="grid grid-cols-2 gap-1 figure text-sm bg-paper-sunken/60 border border-line p-3 mb-3 max-w-xs select-all">
          {codes.map((c) => <span key={c}>{c}</span>)}
        </div>
        <Button onClick={onDone}>I&apos;ve saved them</Button>
      </div>
    );
  }
  if (!setup) {
    return (
      <div>
        {err && <div className="text-accent text-sm mb-2">{err}</div>}
        <Button onClick={start}>Turn on two-step verification</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-6 items-start">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="border border-line bg-white p-1" />
      <div className="flex-1 min-w-[220px] space-y-3">
        <p className="text-sm text-ink-soft">Scan the code, or enter this key manually:</p>
        <div className="figure text-xs break-all select-all">{setup.secret}</div>
        <Field label="Code from the app">
          <input id="enable-code" className={inputCls + " figure tracking-[0.3em]"} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
        </Field>
        {err && <div className="text-accent text-sm">{err}</div>}
        <Button onClick={confirm} disabled={code.replace(/\s/g, "").length !== 6}>Turn on</Button>
      </div>
    </div>
  );
}

function Disable({ onDone, left }: { onDone: () => void; left: number }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const disable = async () => {
    setErr(null);
    const res = await fetch("/api/auth/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) return setErr((await res.json()).error);
    setCode("");
    onDone();
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        {left} unused recovery code{left === 1 ? "" : "s"} left.
        {left <= 2 && " Turn two-step verification off and on again to get a fresh set."}
      </p>
      <div className="flex gap-3 items-end">
        <Field label="Current code, to turn it off">
          <input id="disable-code" className={inputCls + " figure tracking-[0.3em] max-w-[10rem]"} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" />
        </Field>
        <Button variant="danger" onClick={disable} disabled={code.replace(/\s/g, "").length !== 6}>Turn off</Button>
      </div>
      {err && <div className="text-accent text-sm">{err}</div>}
    </div>
  );
}
