"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Step = "password" | "mfa" | "mfa-setup" | "recovery-codes";

const inputCls =
  "w-full border border-line-strong px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-accent";
const buttonCls =
  "w-full bg-ink text-paper py-2.5 text-sm font-medium hover:bg-accent-deep transition-colors disabled:opacity-40";

const SSO_ERRORS: Record<string, string> = {
  not_configured: "Single sign-on isn't set up yet.",
  state: "Sign-in took too long or was started in another tab. Try again.",
  idp: "Your identity provider refused the sign-in.",
  denied: "Your account can't sign in to this console.",
  error: "Single sign-on failed. Try again or contact your administrator.",
};

export default function LoginPage() {
  const router = useRouter();
  const [bootstrap, setBootstrap] = useState<boolean | null>(null);
  const [sso, setSso] = useState<{ enabled: boolean; label: string | null; enforced: boolean } | null>(null);
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/bootstrap").then((r) => r.json()).then((j) => setBootstrap(j.needed));
    fetch("/api/auth/sso/config")
      .then((r) => r.json())
      .then((cfg) => {
        setSso(cfg);
        // Coming back from a failed SSO round-trip
        const q = new URLSearchParams(window.location.search);
        const e = q.get("sso_error");
        if (e) setErr(q.get("detail") || SSO_ERRORS[e] || SSO_ERRORS.error);
      })
      .catch(() => setSso(null));
  }, []);

  const done = () => {
    router.push("/");
    router.refresh();
  };

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { res, json: await res.json().catch(() => ({})) };
  };

  const startSetup = async (token: string) => {
    const { res, json } = await post("/api/auth/mfa/setup", { pendingToken: token });
    if (!res.ok) throw new Error(json.error ?? "Couldn't start two-factor setup");
    setSetup({ qrDataUrl: json.qrDataUrl, secret: json.secret });
    setStep("mfa-setup");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (step === "password") {
        const url = bootstrap ? "/api/auth/bootstrap" : "/api/auth/login";
        const { res, json } = await post(url, bootstrap ? { email, password, name } : { email, password });
        if (!res.ok) throw new Error(json.error ?? "Sign-in failed");
        if (json.mfaRequired) {
          setPendingToken(json.pendingToken);
          setStep("mfa");
        } else if (json.mfaSetupRequired) {
          setPendingToken(json.pendingToken);
          await startSetup(json.pendingToken);
        } else done();
      } else if (step === "mfa") {
        const { res, json } = await post("/api/auth/mfa/verify", {
          pendingToken,
          ...(useRecovery ? { recoveryCode: code } : { code }),
        });
        if (!res.ok) throw new Error(json.error ?? "Code didn't match");
        done();
      } else if (step === "mfa-setup") {
        const { res, json } = await post("/api/auth/mfa/enable", { pendingToken, code });
        if (!res.ok) throw new Error(json.error ?? "Code didn't match");
        setRecoveryCodes(json.recoveryCodes ?? []);
        setStep("recovery-codes");
      } else {
        done();
      }
    } catch (x) {
      setErr((x as Error).message);
      if (step === "mfa") setCode("");
    } finally {
      setBusy(false);
    }
  };

  const heading =
    step === "mfa" ? "two-step verification" : step === "mfa-setup" ? "set up two-step verification" : step === "recovery-codes" ? "save your recovery codes" : bootstrap ? "first-run setup" : "engagement console";

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="card p-8 max-w-sm w-full rise">
        <div className="font-display text-3xl tracking-tight mb-1">
          Dispatch<span className="text-accent">.</span>
        </div>
        <div className="figure text-[10px] uppercase tracking-[0.25em] text-ink-faint mb-6">{heading}</div>

        {step === "password" && (
          <>
            {sso?.enabled && !bootstrap && (
              <>
                <a href="/api/auth/sso/start" className={buttonCls + " block text-center mb-4"}>
                  {sso.label}
                </a>
                <div className="flex items-center gap-3 mb-4 text-[11px] text-ink-faint figure uppercase tracking-wider">
                  <span className="flex-1 border-t border-line" />
                  {sso.enforced ? "administrators" : "or"}
                  <span className="flex-1 border-t border-line" />
                </div>
              </>
            )}
            {bootstrap && (
              <>
                <p className="text-sm text-ink-soft mb-4">
                  No accounts exist yet. Create the first <strong>admin</strong> account.
                </p>
                <input id="name" className={inputCls} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              </>
            )}
            <input id="email" type="email" required autoComplete="username" className={inputCls} placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              id="password"
              type="password"
              required
              autoComplete={bootstrap ? "new-password" : "current-password"}
              minLength={bootstrap ? 8 : undefined}
              className={inputCls.replace("mb-3", "mb-4")}
              placeholder={bootstrap ? "password (8+ characters)" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}

        {step === "mfa" && (
          <>
            <p className="text-sm text-ink-soft mb-4">
              {useRecovery ? "Enter one of your recovery codes. Each code works once." : "Enter the 6-digit code from your authenticator app."}
            </p>
            <input
              id="code"
              autoFocus
              required
              autoComplete="one-time-code"
              inputMode={useRecovery ? "text" : "numeric"}
              className={inputCls + " figure tracking-[0.3em] text-center text-lg"}
              placeholder={useRecovery ? "xxxx-xxxx" : "123 456"}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="button" className="text-xs text-ink-soft underline mb-4" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>
              {useRecovery ? "Use authenticator code instead" : "Lost your device? Use a recovery code"}
            </button>
          </>
        )}

        {step === "mfa-setup" && setup && (
          <>
            <p className="text-sm text-ink-soft mb-3">
              Your administrator requires two-step verification. Scan this with an authenticator app (Microsoft or Google
              Authenticator, 1Password, Okta Verify), then enter the code it shows.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="QR code for your authenticator app" className="mx-auto mb-2 border border-line bg-white p-1" width={180} height={180} />
            <div className="figure text-[11px] text-center text-ink-faint mb-4 break-all select-all">{setup.secret}</div>
            <input id="setup-code" autoFocus required autoComplete="one-time-code" inputMode="numeric" className={inputCls + " figure tracking-[0.3em] text-center text-lg"} placeholder="123 456" value={code} onChange={(e) => setCode(e.target.value)} />
          </>
        )}

        {step === "recovery-codes" && (
          <>
            <p className="text-sm text-ink-soft mb-3">
              Keep these somewhere safe. If you lose your phone, each code signs you in once. They won&apos;t be shown again.
            </p>
            <div className="grid grid-cols-2 gap-1 figure text-sm bg-paper-sunken/60 border border-line p-3 mb-4 select-all">
              {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
          </>
        )}

        {err && <div className="text-accent text-sm mb-3">{err}</div>}

        <button type="submit" disabled={busy || bootstrap === null} className={buttonCls}>
          {busy
            ? "…"
            : step === "mfa"
              ? "Verify"
              : step === "mfa-setup"
                ? "Turn on and continue"
                : step === "recovery-codes"
                  ? "I've saved them — continue"
                  : bootstrap
                    ? "Create admin account"
                    : "Sign in"}
        </button>
      </form>
    </div>
  );
}
