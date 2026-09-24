"use client";

import { useState, useSyncExternalStore } from "react";

/** window.location.origin without a hydration mismatch (server renders it empty). */
const useOrigin = () => useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
import useFetch from "@/lib/useFetch";
import { Badge, Button, Card, Field, PageHeader, inputCls } from "@/components/ui";

interface SesStatus {
  configured: boolean;
  hint?: string;
  error?: string;
  fromEmail?: string;
  region?: string;
  productionAccess?: boolean;
  sendingEnabled?: boolean;
  maxSendRate?: number;
  max24HourSend?: number;
  sentLast24Hours?: number;
  identity?: {
    name: string;
    verified: boolean;
    dkimStatus: string;
    dkimTokens: string[];
    mailFromDomain: string | null;
    mailFromStatus: string | null;
  } | null;
}

export default function SettingsPage() {
  return (
    <div>
      <PageHeader kicker="Administration" title="Settings" />
      <div className="space-y-6 max-w-3xl">
        <SesPanel />
        <VapidPanel />
        <FcmPanel />
        <ApnsPanel />
        <TwilioPanel />
        <DeliveryRulesPanel />
        <SubscriptionGroupsPanel />
        <ApiKeysPanel />
        <WebhooksPanel />
        <IntegrationHealthPanel />
        <WarehousePanel />
        <TeamPanel />
        <SecurityPanel />
        <SsoPanel />
        <SamlPanel />
        <AuditPanel />
      </div>
    </div>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className={`figure mt-0.5 ${ok ? "text-good" : "text-accent"}`}>{ok ? "✓" : "✗"}</span>
      <div>
        <span className="text-sm">{label}</span>
        {detail && <div className="figure text-xs text-ink-faint mt-0.5 break-all">{detail}</div>}
      </div>
    </div>
  );
}

interface SesForm {
  configured: boolean;
  source: string | null;
  form: {
    accessKeyId: string | null;
    secretAccessKey: string | null;
    region: string;
    fromEmail: string;
    fromName: string;
    configurationSet: string;
    maxSendRate: number | null;
  };
}

function SesPanel() {
  const { data: status, refresh: refreshStatus } = useFetch<SesStatus>("/api/settings/ses-status");
  const { data: creds, refresh: refreshCreds } = useFetch<SesForm>("/api/settings/ses");
  const [editing, setEditing] = useState(false);

  return (
    <Card className="rise rise-1">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl">Email — Amazon SES</h2>
        <div className="flex items-center gap-2">
          {creds?.source && <span className="figure text-[10px] uppercase tracking-wider text-ink-faint">from {creds.source}</span>}
          {status && (
            <Badge tone={status.configured && !status.error ? "COMPLETED" : "FAILED"}>
              {status.configured ? (status.error ? "error" : "connected") : "not configured"}
            </Badge>
          )}
          <Button small variant="ghost" onClick={() => setEditing((e) => !e)}>
            {editing ? "Close" : creds?.configured ? "Edit credentials" : "Add credentials"}
          </Button>
        </div>
      </div>

      {editing && creds && (
        <SesCredentialsForm
          initial={creds.form}
          onSaved={() => {
            setEditing(false);
            refreshCreds();
            refreshStatus();
          }}
        />
      )}

      {!status ? null : !status.configured ? (
        <p className="text-sm text-ink-soft">{status.hint}</p>
      ) : status.error ? (
        <p className="figure text-xs text-accent">{status.error}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-4 text-center">
            <div className="bg-paper-sunken p-3">
              <div className="figure text-2xl">{status.maxSendRate}</div>
              <div className="figure text-[10px] uppercase tracking-wider text-ink-faint">msgs / sec</div>
            </div>
            <div className="bg-paper-sunken p-3">
              <div className="figure text-2xl">{status.sentLast24Hours}<span className="text-ink-faint text-sm">/{status.max24HourSend}</span></div>
              <div className="figure text-[10px] uppercase tracking-wider text-ink-faint">sent · 24h</div>
            </div>
            <div className="bg-paper-sunken p-3">
              <div className="figure text-2xl">{status.productionAccess ? "PROD" : "SANDBOX"}</div>
              <div className="figure text-[10px] uppercase tracking-wider text-ink-faint">account mode</div>
            </div>
          </div>
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-1">
            Deliverability checklist — {status.identity?.name ?? status.fromEmail}
          </div>
          <Check ok={!!status.identity?.verified} label="Domain identity verified in SES" />
          <Check
            ok={status.identity?.dkimStatus === "SUCCESS"}
            label={`DKIM (${status.identity?.dkimStatus ?? "NOT SET UP"})`}
            detail={status.identity?.dkimTokens?.length ? `CNAMEs: ${status.identity.dkimTokens.map((t) => `${t}._domainkey`).join(", ")}` : "Publish the 3 CNAME records from SES Easy DKIM"}
          />
          <Check
            ok={status.identity?.mailFromStatus === "SUCCESS"}
            label={`Custom MAIL FROM (${status.identity?.mailFromStatus ?? "not set"})`}
            detail={status.identity?.mailFromDomain ?? "Set mail.yourdomain.com so SPF aligns for DMARC"}
          />
          <Check ok={!!status.productionAccess} label="Production access (out of sandbox)" detail={status.productionAccess ? undefined : "Sandbox: only verified recipients, 200/day. Request production access in the SES console."} />
          <p className="text-xs text-ink-faint mt-3">
            Also publish a DMARC record: <span className="figure">_dmarc TXT &quot;v=DMARC1; p=none; rua=mailto:dmarc@{status.identity?.name ?? "yourdomain"}&quot;</span>
          </p>
        </>
      )}
    </Card>
  );
}

function SesCredentialsForm({ initial, onSaved }: { initial: SesForm["form"]; onSaved: () => void }) {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [region, setRegion] = useState(initial.region);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [fromName, setFromName] = useState(initial.fromName);
  const [configurationSet, setConfigurationSet] = useState(initial.configurationSet);
  const [maxSendRate, setMaxSendRate] = useState(initial.maxSendRate ? String(initial.maxSendRate) : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/settings/ses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessKeyId,
        secretAccessKey,
        region,
        fromEmail,
        fromName,
        configurationSet,
        maxSendRate: maxSendRate ? Number(maxSendRate) : null,
      }),
    });
    if (res.ok) onSaved();
    else {
      setErr(JSON.stringify((await res.json()).error));
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirm("Remove stored AWS credentials? Env vars (if set) will be used instead.")) return;
    await fetch("/api/settings/ses", { method: "DELETE" });
    onSaved();
  };

  return (
    <div className="border border-line bg-paper-sunken/40 p-4 mb-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="AWS access key ID" hint={initial.accessKeyId ? `current: ${initial.accessKeyId}` : undefined}>
          <input className={inputCls + " figure"} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder="AKIA…" />
        </Field>
        <Field label="AWS secret access key" hint={initial.secretAccessKey ? "a secret is currently stored" : undefined}>
          <input type="password" className={inputCls + " figure"} value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} placeholder="••••••••" />
        </Field>
        <Field label="Region">
          <input className={inputCls + " figure"} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="eu-west-1" />
        </Field>
        <Field label="From email (verified in SES)">
          <input className={inputCls} value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="news@yourdomain.com" />
        </Field>
        <Field label="From name (optional)">
          <input className={inputCls} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your App" />
        </Field>
        <Field label="Configuration set (optional)" hint="For bounce/complaint SNS events">
          <input className={inputCls + " figure"} value={configurationSet} onChange={(e) => setConfigurationSet(e.target.value)} placeholder="brazecopy-events" />
        </Field>
        <Field label="Max send rate override (optional)" hint="msgs/sec; blank = read from SES quota">
          <input type="number" className={inputCls + " figure"} value={maxSendRate} onChange={(e) => setMaxSendRate(e.target.value)} />
        </Field>
      </div>
      {err && <div className="text-accent text-sm">{err}</div>}
      <div className="flex gap-3">
        <Button onClick={save} disabled={busy || !fromEmail || !!accessKeyId !== !!secretAccessKey}>
          {busy ? "Saving…" : "Save credentials"}
        </Button>
        <Button variant="danger" small onClick={clear}>Remove stored credentials</Button>
      </div>
      <p className="text-xs text-ink-faint">
        Leave both key fields blank on AWS to use the task&apos;s IAM role (recommended). Stored keys live in the
        database (Setting table) and take effect immediately — no restart needed.
      </p>
    </div>
  );
}

function VapidPanel() {
  const { data, refresh } = useFetch<{ configured: boolean; publicKey: string | null; source: string }>("/api/settings/vapid");
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    await fetch("/api/settings/vapid", { method: "POST" });
    setBusy(false);
    refresh();
  };

  return (
    <Card className="rise rise-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl">Web Push — VAPID</h2>
        {data && <Badge tone={data.configured ? "COMPLETED" : "FAILED"}>{data.configured ? "configured" : "not configured"}</Badge>}
      </div>
      {data?.configured ? (
        <div>
          <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-1">Public key ({data.source})</div>
          <div className="figure text-xs bg-paper-sunken p-3 break-all">{data.publicKey}</div>
          <p className="text-xs text-ink-faint mt-2">
            Browsers subscribe on the <a href="/demo/push" className="text-accent underline">demo page</a> using this key.
          </p>
        </div>
      ) : (
        <div>
          <p className="text-sm text-ink-soft mb-3">Generate a VAPID key pair to enable browser push notifications. No external account needed.</p>
          <Button onClick={generate} disabled={busy}>{busy ? "Generating…" : "Generate VAPID keys"}</Button>
        </div>
      )}
    </Card>
  );
}

function FcmPanel() {
  const { data, refresh } = useFetch<{ configured: boolean; projectId: string | null }>("/api/settings/fcm");
  const [err, setErr] = useState<string | null>(null);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(String(reader.result));
        const res = await fetch("/api/settings/fcm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(json),
        });
        if (!res.ok) setErr((await res.json()).error);
        else setErr(null);
        refresh();
      } catch {
        setErr("Not valid JSON");
      }
    };
    reader.readAsText(file);
  };

  return (
    <Card className="rise rise-3">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl">Mobile Push — Firebase (FCM)</h2>
        {data && <Badge tone={data.configured ? "COMPLETED" : "FAILED"}>{data.configured ? `project: ${data.projectId}` : "not configured"}</Badge>}
      </div>
      <p className="text-sm text-ink-soft mb-3">
        Upload a Firebase <span className="figure text-xs">service-account.json</span> (Project settings → Service accounts → Generate new private key).
        Covers Android and iOS. Apps register tokens through the SDK (<span className="figure text-xs">POST /api/sdk/v1/push/register</span>).
        On AWS you can instead inject the JSON as the <span className="figure text-xs">FCM_SERVICE_ACCOUNT_JSON</span> secret.
      </p>
      <input type="file" accept="application/json" className="text-sm" aria-label="Firebase service-account JSON file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {err && <div className="text-accent text-sm mt-2">{err}</div>}
      {data?.configured && (
        <div className="mt-3">
          <Button variant="danger" small onClick={async () => { await fetch("/api/settings/fcm", { method: "DELETE" }); refresh(); }}>
            Remove credentials
          </Button>
        </div>
      )}
    </Card>
  );
}

interface TwilioForm {
  configured: boolean;
  source: "env" | "settings" | null;
  accountSid: string;
  hasToken: boolean;
  messagingServiceSid: string;
  fromNumber: string;
  whatsappFrom: string;
  webhookUrl: string;
}

function TwilioPanel() {
  const { data, refresh } = useFetch<TwilioForm>("/api/settings/twilio");
  if (!data) return null;
  return <TwilioFormView key={data.accountSid + data.messagingServiceSid + data.whatsappFrom} initial={data} onSaved={refresh} />;
}

function TwilioFormView({ initial, onSaved }: { initial: TwilioForm; onSaved: () => void }) {
  const [f, setF] = useState({ accountSid: initial.accountSid, authToken: "", messagingServiceSid: initial.messagingServiceSid, fromNumber: initial.fromNumber, whatsappFrom: initial.whatsappFrom });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setMsg(null); };
  const save = async () => {
    const res = await fetch("/api/settings/twilio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(typeof json.error === "string" ? json.error : "Check the fields and try again.");
    setMsg("Saved — credentials checked with Twilio.");
    onSaved();
  };
  return (
    <Card className="rise rise-3">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl">SMS &amp; WhatsApp — Twilio</h2>
        {initial.configured ? <Badge tone="COMPLETED">configured</Badge> : <Badge>not configured</Badge>}
      </div>
      <p className="text-sm text-ink-soft mb-3">
        Sends SMS through a Twilio Messaging Service (recommended: sender pool, queueing, STOP handling) or a single number,
        and WhatsApp through an approved WhatsApp sender. Set <code className="figure text-xs">{initial.webhookUrl}</code> as the
        incoming-message webhook of the Messaging Service / WhatsApp sender: delivery receipts, WhatsApp read receipts and
        STOP / START replies are applied automatically. Readers need a phone number in E.164 format (+44…).
        {initial.source === "env" && " Currently configured from TWILIO_* environment variables."}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Account SID"><input className={inputCls + " figure"} value={f.accountSid} onChange={(e) => set({ accountSid: e.target.value.trim() })} placeholder="AC…" /></Field>
        <Field label="Auth token" hint={initial.hasToken ? "Leave blank to keep the saved token" : undefined}>
          <input type="password" autoComplete="off" className={inputCls + " figure"} value={f.authToken} onChange={(e) => set({ authToken: e.target.value.trim() })} />
        </Field>
        <Field label="Messaging Service SID (SMS)"><input className={inputCls + " figure"} value={f.messagingServiceSid} onChange={(e) => set({ messagingServiceSid: e.target.value.trim() })} placeholder="MG…" /></Field>
        <Field label="…or SMS from number"><input className={inputCls + " figure"} value={f.fromNumber} onChange={(e) => set({ fromNumber: e.target.value.trim() })} placeholder="+447700900123" /></Field>
        <Field label="WhatsApp sender"><input className={inputCls + " figure"} value={f.whatsappFrom} onChange={(e) => set({ whatsappFrom: e.target.value.trim() })} placeholder="+14155238886" /></Field>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <Button onClick={save} disabled={!f.accountSid || (!f.authToken && !initial.hasToken)}>Save</Button>
        {initial.configured && initial.source === "settings" && (
          <Button variant="danger" onClick={async () => { if (confirm("Remove the Twilio credentials?")) { await fetch("/api/settings/twilio", { method: "DELETE" }); onSaved(); } }}>Remove</Button>
        )}
        {msg && <span className="text-sm text-ink-soft" role="status">{msg}</span>}
      </div>
    </Card>
  );
}

function DeliveryRulesPanel() {
  const { data, refresh } = useFetch<{ maxPerDay: number | null; maxPerWeek: number | null; quietStart: string | null; quietEnd: string | null }>("/api/settings/delivery-rules");
  const [maxPerDay, setMaxPerDay] = useState("");
  const [maxPerWeek, setMaxPerWeek] = useState("");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  if (data && !loaded) {
    setMaxPerDay(data.maxPerDay ? String(data.maxPerDay) : "");
    setMaxPerWeek(data.maxPerWeek ? String(data.maxPerWeek) : "");
    setQuietStart(data.quietStart ?? "");
    setQuietEnd(data.quietEnd ?? "");
    setLoaded(true);
  }

  const save = async () => {
    await fetch("/api/settings/delivery-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        maxPerDay: maxPerDay ? Number(maxPerDay) : null,
        maxPerWeek: maxPerWeek ? Number(maxPerWeek) : null,
        quietStart: quietStart || null,
        quietEnd: quietEnd || null,
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    refresh();
  };

  return (
    <Card className="rise rise-3">
      <h2 className="text-xl mb-1">Delivery rules</h2>
      <p className="text-sm text-ink-soft mb-4">
        Frequency capping and quiet hours apply to every campaign and journey send (tests are exempt).
      </p>
      <div className="grid grid-cols-4 gap-3">
        <Field label="Max / day / contact">
          <input type="number" min={1} className={inputCls + " figure"} value={maxPerDay} placeholder="∞" onChange={(e) => setMaxPerDay(e.target.value)} />
        </Field>
        <Field label="Max / week / contact">
          <input type="number" min={1} className={inputCls + " figure"} value={maxPerWeek} placeholder="∞" onChange={(e) => setMaxPerWeek(e.target.value)} />
        </Field>
        <Field label="Quiet hours start">
          <input type="time" className={inputCls + " figure"} value={quietStart} onChange={(e) => setQuietStart(e.target.value)} />
        </Field>
        <Field label="Quiet hours end">
          <input type="time" className={inputCls + " figure"} value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button small onClick={save}>Save rules</Button>
        {saved && <span className="text-good text-sm">✓ saved</span>}
        <span className="text-xs text-ink-faint">Messages hitting quiet hours are delayed to the window end; over-cap messages are suppressed.</span>
      </div>
    </Card>
  );
}

type GroupRow = {
  id: string; name: string; slug: string | null; description: string | null; optIn: boolean;
  kind: "newsletter" | "topic"; subscribers: number; optedOut: number; _count: { campaigns: number };
};

function SubscriptionGroupsPanel() {
  const { data, refresh } = useFetch<GroupRow[]>("/api/subscription-groups");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [optIn, setOptIn] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const res = await fetch("/api/subscription-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, slug, optIn }),
    });
    if (res.ok) {
      setName(""); setSlug(""); setDescription(""); setErr(null);
      refresh();
    } else {
      const e = (await res.json()).error;
      setErr(typeof e === "string" ? e : "check the name and slug");
    }
  };

  const setKind = async (g: GroupRow, toOptIn: boolean) => {
    await fetch(`/api/subscription-groups/${g.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optIn: toOptIn }),
    });
    refresh();
  };

  return (
    <Card className="rise rise-3">
      <h2 className="text-xl mb-1">Newsletters &amp; topics</h2>
      <p className="text-sm text-ink-soft mb-4">
        <b>Newsletters</b> reach only people who subscribed — from the app (SDK preferences), the email preference centre or{" "}
        <code className="figure text-xs">POST /api/v1/subscriptions</code>. <b>Topics</b> reach everyone until they opt out.
        Pick one on a campaign to target it.
      </p>
      {(data ?? []).map((g) => (
        <div key={g.id} className="flex items-center justify-between py-2 border-b border-line text-sm gap-3">
          <div className="min-w-0">
            <span className={`figure text-[10px] uppercase tracking-wider mr-2 px-1.5 py-0.5 rounded ${g.optIn ? "bg-accent/10 text-accent" : "bg-ink/5 text-ink-soft"}`}>
              {g.kind}
            </span>
            <span className="font-medium">{g.name}</span>
            {g.slug && <span className="figure text-ink-faint ml-2 text-xs">{g.slug}</span>}
            {g.description && <span className="block text-ink-faint text-xs mt-0.5">{g.description}</span>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="figure text-xs text-ink-faint">
              {g.optIn ? `${g.subscribers} subscribed` : `${g.optedOut} opted out`} · {g._count.campaigns} campaigns
            </span>
            <Button small variant="ghost" onClick={() => setKind(g, !g.optIn)}>make {g.optIn ? "topic" : "newsletter"}</Button>
            <Button small variant="danger" onClick={async () => {
              if (!confirm(`Delete "${g.name}"? Subscriptions to it are removed.`)) return;
              await fetch(`/api/subscription-groups/${g.id}`, { method: "DELETE" });
              refresh();
            }}>delete</Button>
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <input className={inputCls} placeholder="Name (e.g. Morning Briefing)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls + " figure"} placeholder="slug (e.g. morning-briefing)" value={slug} onChange={(e) => setSlug(e.target.value)} />
        <input className={inputCls + " col-span-2"} placeholder="Description shown to readers (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <select className={inputCls} aria-label="Kind" value={optIn ? "newsletter" : "topic"} onChange={(e) => setOptIn(e.target.value === "newsletter")}>
          <option value="newsletter">Newsletter — subscribers only</option>
          <option value="topic">Topic — everyone until they opt out</option>
        </select>
        <Button onClick={add} disabled={!name}>Add</Button>
      </div>
      {err && <div className="text-accent text-sm mt-2">{err}</div>}
    </Card>
  );
}

interface AlertRow {
  id: string; key: string; source: string; severity: "WARNING" | "CRITICAL"; title: string; detail: string | null;
  count: number; firstAt: string; lastAt: string; resolvedAt: string | null;
}

function IntegrationHealthPanel() {
  const { data, refresh } = useFetch<{ webhookUrl: string | null; fromEnv: boolean; alerts: AlertRow[] }>("/api/settings/alerts");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (value: string | null) => {
    const res = await fetch("/api/settings/alerts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ webhookUrl: value }),
    });
    setMsg(res.ok ? (value ? "Saved." : "Removed.") : (await res.json()).error);
    if (res.ok) { setUrl(""); refresh(); }
  };
  const test = async () => {
    const res = await fetch("/api/settings/alerts?test=1", { method: "POST" });
    setMsg(res.ok ? "Test message sent." : (await res.json()).error);
  };

  return (
    <Card className="rise rise-4">
      <div id="integration-health" className="scroll-mt-8" />
      <h2 className="text-xl mb-1">Integration health</h2>
      <p className="text-sm text-ink-soft mb-4">
        Dispatch raises an alert when a webhook endpoint, a push or email provider, or a content feed keeps failing,
        shows it on every console page and posts it to Slack or Teams. Alerts close by themselves when the integration
        recovers. Webhook endpoints are paused after 100 consecutive failures.
      </p>
      <div className="text-sm mb-2">
        Notify: {data?.webhookUrl ? <span className="figure">{data.webhookUrl}</span> : data?.fromEnv ? "ALERT_WEBHOOK_URL (environment)" : <span className="text-ink-faint">not configured</span>}
      </div>
      <div className="flex gap-2 mb-2">
        <input className={inputCls + " flex-1"} placeholder="https://hooks.slack.com/services/… or a Teams workflow URL" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Alert webhook URL" />
        <Button onClick={() => save(url)} disabled={!url}>Save</Button>
        {(data?.webhookUrl || data?.fromEnv) && <Button variant="ghost" onClick={test}>Send test</Button>}
        {data?.webhookUrl && <Button variant="danger" onClick={() => save(null)}>Remove</Button>}
      </div>
      {msg && <div className="text-xs text-ink-soft mb-2" role="status">{msg}</div>}
      <h3 className="figure text-[11px] uppercase tracking-[0.15em] text-ink-soft mt-4 mb-1">Recent alerts</h3>
      {!data?.alerts.length && <div className="text-sm text-ink-faint py-2">No alerts — every integration is healthy.</div>}
      {(data?.alerts ?? []).map((a) => (
        <div key={a.id} className={`py-2 border-b border-line text-sm flex justify-between gap-3 ${a.resolvedAt ? "opacity-60" : ""}`}>
          <div className="min-w-0">
            <Badge tone={a.resolvedAt ? "COMPLETED" : a.severity === "CRITICAL" ? "FAILED" : "SCHEDULED"}>
              {a.resolvedAt ? "resolved" : a.severity.toLowerCase()}
            </Badge>{" "}
            <span className="font-medium">{a.title}</span>
            {a.detail && <div className="text-xs text-ink-faint mt-0.5 break-words">{a.detail}</div>}
            <div className="figure text-[11px] text-ink-faint mt-0.5">
              {a.count}× · first {new Date(a.firstAt).toLocaleString()} · last {new Date(a.lastAt).toLocaleString()}
              {a.resolvedAt && ` · resolved ${new Date(a.resolvedAt).toLocaleString()}`}
            </div>
          </div>
          {!a.resolvedAt && (
            <Button small variant="ghost" onClick={async () => { await fetch(`/api/settings/alerts/${a.id}`, { method: "PATCH" }); refresh(); }}>
              resolve
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}

function WarehousePanel() {
  const [target, setTarget] = useState<"snowflake" | "redshift" | "bigquery">("snowflake");
  const { data, refresh } = useFetch<{ bucket: string | null; prefix: string; daily: boolean; dailyFromEnv: boolean; lastDaily: string | null; setup: string | null }>(`/api/settings/warehouse?target=${target}`);
  const [msg, setMsg] = useState<string | null>(null);
  const post = async (body: object, ok: string) => {
    const res = await fetch("/api/settings/warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setMsg(res.ok ? ok : (await res.json()).error);
    refresh();
  };
  return (
    <Card className="rise rise-4">
      <h2 className="text-xl mb-1">Data warehouse</h2>
      <p className="text-sm text-ink-soft mb-4">
        Every night Dispatch lands the previous day&apos;s events, messages and message events in S3 as gzipped NDJSON
        (<code className="figure text-xs">{data?.bucket ? `s3://${data.bucket}/${data.prefix}/<type>/daily-YYYY-MM-DD/` : "EXPORT_S3_BUCKET not set"}</code>).
        Snowflake, Redshift and BigQuery load it with their own S3 ingestion; the setup below creates the tables and the daily load.
      </p>
      <div className="flex items-center gap-3 mb-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!data?.daily} disabled={!data?.bucket || data?.dailyFromEnv} onChange={(e) => post({ daily: e.target.checked }, e.target.checked ? "Daily export on." : "Daily export off.")} />
          Export every night{data?.dailyFromEnv ? " (EXPORT_S3_DAILY)" : ""}
        </label>
        <span className="text-ink-faint">last run: {data?.lastDaily ?? "never"}</span>
        <Button small variant="ghost" disabled={!data?.bucket} onClick={() => post({ exportNow: true }, "Yesterday's export queued.")}>Export yesterday now</Button>
        {msg && <span className="text-ink-soft" role="status">{msg}</span>}
      </div>
      <div className="flex gap-2 mb-2" role="tablist" aria-label="Warehouse">
        {(["snowflake", "redshift", "bigquery"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={target === t} onClick={() => setTarget(t)} className={`text-sm px-3 py-1 border ${target === t ? "border-accent text-accent" : "border-line text-ink-soft"}`}>
            {{ snowflake: "Snowflake", redshift: "Redshift", bigquery: "BigQuery" }[t]}
          </button>
        ))}
      </div>
      <div className="flex justify-end -mt-9 mb-2">
        <Button small variant="ghost" onClick={() => data?.setup && navigator.clipboard.writeText(data.setup).then(() => setMsg("Copied."))}>Copy</Button>
      </div>
      <pre className="figure text-[11px] bg-paper-sunken border border-line p-3 max-h-80 overflow-auto whitespace-pre" tabIndex={0} aria-label={`${target} setup`}>{data?.setup}</pre>
    </Card>
  );
}

function ApiKeysPanel() {
  const origin = useOrigin();
  const { data, refresh } = useFetch<{
    keys: { id: string; name: string; prefix: string; scope: "SERVER" | "SDK"; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; requests30d: number }[];
    usage: { byEndpoint: Record<string, number>; total30d: number };
  }>("/api/settings/api-keys");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"SERVER" | "SDK">("SERVER");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const create = async () => {
    const res = await fetch("/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scope }),
    });
    if (res.ok) {
      const json = await res.json();
      setFreshKey(json.key);
      setName("");
      refresh();
    }
  };

  return (
    <Card className="rise rise-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl">REST API keys</h2>
        {data && <span className="figure text-xs text-ink-faint">{data.usage.total30d.toLocaleString()} requests · 30d</span>}
      </div>
      <p className="text-sm text-ink-soft mb-4">
        <b>Server</b> keys stay on your backend: sends (<span className="figure text-xs">/api/v1/campaigns/trigger</span>), bulk
        user updates, exports. <b>SDK</b> keys ship inside your apps and can only identify users, track events and register
        push tokens (<span className="figure text-xs">/api/sdk/v1/*</span>). While no keys exist the SDK endpoints are open (dev
        mode); the server API always needs a key.
      </p>

      {freshKey && (
        <div className="bg-amber-wash border border-amber/40 p-3 mb-4">
          <div className="figure text-[11px] uppercase tracking-wider text-amber mb-1">Copy now — shown only once</div>
          <code className="figure text-xs break-all select-all">{freshKey}</code>
        </div>
      )}

      {(data?.keys ?? []).map((k) => (
        <div key={k.id} className={`flex items-center justify-between py-2 border-b border-line text-sm ${k.revokedAt ? "opacity-40" : ""}`}>
          <div>
            <span className="font-medium">{k.name}</span>
            <span className="figure text-xs text-ink-faint ml-2">{k.prefix}…</span>
            <span className="ml-2"><Badge tone={k.scope === "SDK" ? "SCHEDULED" : "RUNNING"}>{k.scope.toLowerCase()}</Badge></span>
            {k.revokedAt && <Badge tone="FAILED">revoked</Badge>}
          </div>
          <div className="flex items-center gap-3">
            <span className="figure text-xs text-ink-faint">
              {k.requests30d.toLocaleString()} req · {k.lastUsedAt ? `last ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}
            </span>
            {!k.revokedAt && (
              <Button small variant="danger" onClick={async () => {
                if (!confirm(`Revoke key "${k.name}"?`)) return;
                await fetch(`/api/settings/api-keys/${k.id}`, { method: "DELETE" });
                refresh();
              }}>revoke</Button>
            )}
          </div>
        </div>
      ))}

      {data && Object.keys(data.usage.byEndpoint).length > 0 && (
        <div className="figure text-xs text-ink-faint mt-3">
          {Object.entries(data.usage.byEndpoint).map(([e, n]) => `${e}: ${n.toLocaleString()}`).join(" · ")}
        </div>
      )}

      <div className="flex gap-3 mt-4">
        <input className={inputCls + " max-w-xs"} placeholder="Key name (e.g. ios-app)" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={inputCls + " max-w-[9rem]"} aria-label="Key scope" value={scope} onChange={(e) => setScope(e.target.value as "SERVER" | "SDK")}>
          <option value="SERVER">Server key</option>
          <option value="SDK">SDK key</option>
        </select>
        <Button onClick={create} disabled={!name}>Create key</Button>
      </div>
      <p className="figure text-[11px] text-ink-faint mt-3">
        curl -H &quot;Authorization: Bearer dk_…&quot; -H &quot;Content-Type: application/json&quot; -d &apos;{"{"}&quot;email&quot;:&quot;a@b.co&quot;,&quot;event&quot;:&quot;signup&quot;{"}"}&apos; {origin}/api/track
      </p>
    </Card>
  );
}

interface TeamUser {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "USER";
  createdAt: string;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  ssoSubject: string | null;
}

function TeamPanel() {
  const { data: users, refresh } = useFetch<TeamUser[]>("/api/users");
  const { data: me } = useFetch<{ email: string; role: string }>("/api/auth/me");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "USER">("USER");
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setErr(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, name, password, role }),
    });
    if (res.ok) {
      setEmail(""); setName(""); setPassword("");
      refresh();
    } else setErr(JSON.stringify((await res.json()).error));
  };

  const act = async (id: string, patch: object) => {
    setErr(null);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) setErr((await res.json()).error);
    refresh();
  };

  const remove = async (id: string, email: string) => {
    if (!confirm(`Delete account ${email}?`)) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (!res.ok) setErr((await res.json()).error);
    refresh();
  };

  return (
    <Card className="rise rise-4">
      <h2 className="text-xl mb-4">Team</h2>
      <table className="w-full text-sm mb-5">
        <thead>
          <tr className="text-left figure text-[11px] uppercase tracking-wider text-ink-faint border-b border-line">
            <th className="py-2 pr-4 font-normal">Email</th>
            <th className="pr-4 font-normal">Name</th>
            <th className="pr-4 font-normal">Role</th>
            <th className="font-normal"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(users ?? []).map((u) => (
            <tr key={u.id}>
              <td className="py-2.5 pr-4">
                {u.email} {me?.email === u.email && <span className="figure text-[10px] text-accent">(you)</span>}
              </td>
              <td className="pr-4 text-ink-soft">
                {u.name ?? "—"}
                <div className="figure text-[10px] text-ink-faint">
                  {u.lastLoginAt ? `last sign-in ${new Date(u.lastLoginAt).toLocaleDateString()}` : "never signed in"}
                </div>
              </td>
              <td className="pr-4 space-x-1 whitespace-nowrap">
                <Badge tone={u.role === "ADMIN" ? "RUNNING" : "QUEUED"}>{u.role}</Badge>
                {u.mfaEnabled && <Badge tone="COMPLETED">2FA</Badge>}
                {u.ssoSubject && <Badge tone="SCHEDULED">SSO</Badge>}
              </td>
              <td className="text-right space-x-2">
                <Button small variant="ghost" onClick={() => act(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" })}>
                  make {u.role === "ADMIN" ? "user" : "admin"}
                </Button>
                <Button small variant="ghost" onClick={() => {
                  const pw = prompt(`New password for ${u.email} (8+ chars):`);
                  if (pw) act(u.id, { password: pw });
                }}>
                  reset pw
                </Button>
                {u.mfaEnabled && (
                  <Button small variant="ghost" onClick={() => {
                    if (confirm(`Turn off two-step verification for ${u.email}? They can set it up again at next sign-in.`)) act(u.id, { resetMfa: true });
                  }}>
                    reset 2FA
                  </Button>
                )}
                <Button small variant="danger" onClick={() => remove(u.id, u.email)}>delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">Invite a team member</div>
      <div className="grid grid-cols-4 gap-3">
        <input className={inputCls} placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={inputCls} placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} type="password" placeholder="password (8+)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex gap-2">
          <select className={inputCls} aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
            <option value="USER">USER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <Button onClick={add} disabled={!email || password.length < 8}>Add</Button>
        </div>
      </div>
      {err && <div className="text-accent text-sm mt-3">{err}</div>}
      <p className="text-xs text-ink-faint mt-3">
        Admins see this Settings page and manage credentials; users get the full console without Settings.
      </p>
    </Card>
  );
}

function ApnsPanel() {
  const { data, refresh } = useFetch<{
    configured: boolean;
    source: string | null;
    keyId: string | null;
    teamId: string | null;
    bundleId: string | null;
    production: boolean;
  }>("/api/settings/apns");
  const [form, setForm] = useState({ keyId: "", teamId: "", bundleId: "", privateKey: "", production: true });
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setErr(null);
    const res = await fetch("/api/settings/apns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) setErr(JSON.stringify((await res.json()).error));
    else {
      set({ privateKey: "" });
      refresh();
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const m = file.name.match(/AuthKey_([A-Z0-9]{10})\.p8/);
      set({ privateKey: String(reader.result), ...(m ? { keyId: m[1] } : {}) });
    };
    reader.readAsText(file);
  };

  return (
    <Card className="rise rise-3">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl">iOS Push — APNs direct</h2>
        {data && (
          <Badge tone={data.configured ? "COMPLETED" : "FAILED"}>
            {data.configured ? `${data.bundleId} · ${data.production ? "production" : "sandbox"}` : "not configured"}
          </Badge>
        )}
      </div>
      <p className="text-sm text-ink-soft mb-3">
        Send to iOS without Firebase using an APNs auth key (Apple Developer → Keys → <span className="figure text-xs">AuthKey_XXXXXXXXXX.p8</span>).
        On AWS, the <span className="figure text-xs">APNS_*</span> secrets override this form.
      </p>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Field label="Key ID"><input className={inputCls + " figure"} value={form.keyId} onChange={(e) => set({ keyId: e.target.value })} placeholder={data?.keyId ?? "ABC123DEFG"} /></Field>
        <Field label="Team ID"><input className={inputCls + " figure"} value={form.teamId} onChange={(e) => set({ teamId: e.target.value })} placeholder={data?.teamId ?? "TEAM123456"} /></Field>
        <Field label="Bundle ID (topic)"><input className={inputCls + " figure"} value={form.bundleId} onChange={(e) => set({ bundleId: e.target.value })} placeholder={data?.bundleId ?? "com.example.app"} /></Field>
      </div>
      <div className="flex items-center gap-4 mb-3">
        <input type="file" accept=".p8" className="text-sm" aria-label="APNs auth key (.p8) file" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        {form.privateKey && <span className="figure text-xs text-good">key loaded</span>}
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" checked={!form.production} onChange={(e) => set({ production: !e.target.checked })} /> sandbox (development builds)
        </label>
      </div>
      {err && <div className="text-accent text-sm mb-2">{err}</div>}
      <div className="flex gap-3">
        <Button onClick={save} disabled={!form.keyId || !form.teamId || !form.bundleId || !form.privateKey}>Save APNs key</Button>
        {data?.source === "settings" && (
          <Button variant="danger" small onClick={async () => { await fetch("/api/settings/apns", { method: "DELETE" }); refresh(); }}>
            Remove
          </Button>
        )}
      </div>
    </Card>
  );
}

interface WebhookRow {
  id: string;
  kind: "WEBHOOK" | "SEGMENT";
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
  lastError: string | null;
  lastSuccessAt: string | null;
  secretPreview: string;
}

function WebhooksPanel() {
  const { data, refresh } = useFetch<{ eventTypes: string[]; endpoints: WebhookRow[] }>("/api/settings/webhooks");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"WEBHOOK" | "SEGMENT">("WEBHOOK");
  const [url, setUrl] = useState("");
  const [writeKey, setWriteKey] = useState("");
  const [region, setRegion] = useState<"us" | "eu">("us");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const create = async () => {
    setErr(null);
    const res = await fetch("/api/settings/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "SEGMENT" ? { kind, name, writeKey, region, events } : { kind, name, url, events }),
    });
    const json = await res.json();
    if (!res.ok) return setErr(JSON.stringify(json.error));
    setSecret(json.secret ?? null);
    setName("");
    setUrl("");
    setWriteKey("");
    setEvents([]);
    refresh();
  };

  return (
    <Card className="rise rise-4">
      <h2 className="text-xl mb-1">Event webhooks</h2>
      <p className="text-sm text-ink-soft mb-4">
        Stream message events (sent, delivered, opened, clicked, failed…) to your data platform as signed JSON batches.
        Verify <span className="figure text-xs">X-Dispatch-Signature: t=…,v1=HMAC_SHA256(secret, &quot;t.body&quot;)</span>; delivery is
        at-least-once, so dedupe on event <span className="figure text-xs">id</span>.
      </p>
      {secret && (
        <div className="bg-amber-wash border border-amber/40 p-3 mb-4">
          <div className="figure text-[11px] uppercase tracking-wider text-amber mb-1">Signing secret — shown only once</div>
          <code className="figure text-xs break-all select-all">{secret}</code>
        </div>
      )}
      {(data?.endpoints ?? []).map((e) => (
        <div key={e.id} className={`py-2 border-b border-line text-sm ${e.isActive ? "" : "opacity-50"}`}>
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">{e.name}</span>
              {e.kind === "SEGMENT" && <span className="ml-2"><Badge tone="SCHEDULED">segment</Badge></span>}
              <span className="figure text-xs text-ink-faint ml-2 break-all">{e.url}</span>
            </div>
            <div className="flex gap-2">
              <Button small variant="ghost" onClick={async () => {
                await fetch(`/api/settings/webhooks/${e.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !e.isActive }) });
                refresh();
              }}>{e.isActive ? "pause" : "resume"}</Button>
              <Button small variant="danger" onClick={async () => {
                if (!confirm(`Delete webhook "${e.name}"?`)) return;
                await fetch(`/api/settings/webhooks/${e.id}`, { method: "DELETE" });
                refresh();
              }}>delete</Button>
            </div>
          </div>
          <div className="figure text-xs text-ink-faint mt-1">
            {e.events.length ? e.events.join(", ") : "all events"} ·{" "}
            {e.lastSuccessAt ? `last ok ${new Date(e.lastSuccessAt).toLocaleString()}` : "no deliveries yet"}
            {e.failureCount > 0 && <span className="text-accent"> · {e.failureCount} failures — {e.lastError}</span>}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <select id="wh-kind" aria-label="Endpoint type" className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as "WEBHOOK" | "SEGMENT")}>
          <option value="WEBHOOK">Signed webhook</option>
          <option value="SEGMENT">Twilio Segment</option>
        </select>
        <input id="wh-name" className={inputCls} placeholder="Name (e.g. data-lake)" value={name} onChange={(e) => setName(e.target.value)} />
        {kind === "WEBHOOK" ? (
          <input id="wh-url" className={inputCls + " figure"} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        ) : (
          <div className="flex gap-2">
            <input id="wh-writekey" className={inputCls + " figure"} placeholder="Segment write key" value={writeKey} onChange={(e) => setWriteKey(e.target.value)} />
            <select id="wh-region" className={inputCls + " w-20"} value={region} onChange={(e) => setRegion(e.target.value as "us" | "eu")}>
              <option value="us">US</option>
              <option value="eu">EU</option>
            </select>
          </div>
        )}
      </div>
      {kind === "SEGMENT" && (
        <p className="text-xs text-ink-faint mt-2">
          Sends events to Segment as track calls (Push Notification Received, Email Opened…). To send Segment data <i>into</i> Dispatch,
          add Segment&apos;s Webhooks destination pointing at <span className="figure">/api/integrations/segment</span> with a server key.
        </p>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
        {(data?.eventTypes ?? []).map((t) => (
          <label key={t} className="figure text-xs flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={events.includes(t)}
              onChange={(e) => setEvents((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))}
            />
            {t}
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-faint mt-1">None ticked = every event type.</p>
      {err && <div className="text-accent text-sm mt-2">{err}</div>}
      <div className="mt-3">
        <Button onClick={create} disabled={!name || (kind === "WEBHOOK" ? !url : !writeKey)}>Add endpoint</Button>
      </div>
    </Card>
  );
}

interface AuditRow {
  id: string;
  createdAt: string;
  userEmail: string | null;
  action: string;
  entityId: string | null;
  status: number | null;
  ip: string | null;
}

function AuditPanel() {
  const [q, setQ] = useState({ user: "", action: "", page: 1 });
  const qs = new URLSearchParams({ user: q.user, action: q.action, page: String(q.page) }).toString();
  const { data } = useFetch<{ rows: AuditRow[]; total: number; pageSize: number; retentionDays: number | null }>(`/api/settings/audit?${qs}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Card className="rise rise-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl">Audit log</h2>
        <a className="figure text-xs underline" href={`/api/settings/audit?${new URLSearchParams({ user: q.user, action: q.action, format: "csv" })}`}>
          export CSV
        </a>
      </div>
      <p className="text-sm text-ink-soft mb-3">
        Every sign-in (and failed attempt), every change made in the console, and every API deletion or export — with user, IP and
        time. Kept {data?.retentionDays ?? 400} days (<span className="figure text-xs">AUDIT_RETENTION_DAYS</span>).
      </p>
      <div className="flex gap-3 mb-3">
        <input className={inputCls} placeholder="Filter by user" value={q.user} onChange={(e) => setQ({ ...q, user: e.target.value, page: 1 })} />
        <input className={inputCls} placeholder="Filter by action (e.g. launch)" value={q.action} onChange={(e) => setQ({ ...q, action: e.target.value, page: 1 })} />
      </div>
      <div className="max-h-96 overflow-y-auto" tabIndex={0} role="region" aria-label="Audit log entries">
        {(data?.rows ?? []).map((r) => (
          <div key={r.id} className="grid grid-cols-[9rem_11rem_1fr] gap-3 py-1.5 border-b border-line text-xs">
            <span className="figure text-ink-faint">{new Date(r.createdAt).toLocaleString()}</span>
            <span className="truncate">{r.userEmail ?? "—"}</span>
            <span className="figure break-all">
              {r.action}
              {r.status === 403 && <span className="text-accent"> · denied</span>}
              {r.status === 401 && <span className="text-accent"> · failed</span>}
              {r.ip && <span className="text-ink-faint"> · {r.ip}</span>}
            </span>
          </div>
        ))}
        {data && !data.rows.length && <div className="text-sm text-ink-faint py-3">No entries.</div>}
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-3 mt-3 text-xs">
          <Button small variant="ghost" disabled={q.page <= 1} onClick={() => setQ({ ...q, page: q.page - 1 })}>prev</Button>
          <span className="figure">{q.page} / {pages}</span>
          <Button small variant="ghost" disabled={q.page >= pages} onClick={() => setQ({ ...q, page: q.page + 1 })}>next</Button>
        </div>
      )}
    </Card>
  );
}

function SecurityPanel() {
  const { data, refresh } = useFetch<{ requireMfa: boolean; enforceSso: boolean }>("/api/settings/security");
  const [err, setErr] = useState<string | null>(null);
  if (!data) return null;
  const save = async (patch: Partial<{ requireMfa: boolean; enforceSso: boolean }>) => {
    setErr(null);
    const res = await fetch("/api/settings/security", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, ...patch }),
    });
    if (!res.ok) setErr((await res.json()).error);
    refresh();
  };
  return (
    <Card className="rise rise-4">
      <h2 className="text-xl mb-1">Sign-in policy</h2>
      <p className="text-sm text-ink-soft mb-4">Applies to everyone at their next sign-in.</p>
      <label className="flex items-start gap-2.5 text-sm mb-3">
        <input type="checkbox" className="mt-1" checked={data.requireMfa} onChange={(e) => save({ requireMfa: e.target.checked })} />
        <span>
          Require two-step verification for password sign-in
          <span className="block text-xs text-ink-faint">People without it set it up before they can continue. Turn it on for your own account first.</span>
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-1" checked={data.enforceSso} onChange={(e) => save({ enforceSso: e.target.checked })} />
        <span>
          Only allow single sign-on
          <span className="block text-xs text-ink-faint">Password sign-in stays available to admins as break-glass access, so a broken identity provider can&apos;t lock you out.</span>
        </span>
      </label>
      {err && <div className="text-accent text-sm mt-3">{err}</div>}
    </Card>
  );
}

interface SsoForm {
  configured: boolean;
  source: string | null;
  redirectUri: string;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRole: "USER" | "ADMIN";
  adminGroups: string[];
  buttonLabel: string;
}

interface SamlForm {
  configured: boolean;
  source: "env" | "settings" | null;
  spEntityId: string;
  acsUrl: string;
  metadataUrl: string;
  entryPoint: string;
  idpIssuer: string;
  cert: { subject: string; validTo: string; expired: boolean } | null;
  emailAttributes: string[];
  groupsAttributes: string[];
  allowedDomains: string[];
  autoProvision: boolean;
  defaultRole: "USER" | "ADMIN";
  adminGroups: string[];
  buttonLabel: string;
}

function SamlPanel() {
  const { data, refresh } = useFetch<SamlForm>("/api/settings/saml");
  if (!data) return null;
  return <SamlFormView key={data.entryPoint + (data.cert?.validTo ?? "")} initial={data} onSaved={refresh} />;
}

/** SAML 2.0 — for identity providers such as PingFederate / PingOne (with PingID), ADFS, Okta. */
function SamlFormView({ initial, onSaved }: { initial: SamlForm; onSaved: () => void }) {
  const [f, setF] = useState({
    entryPoint: initial.entryPoint,
    idpIssuer: initial.idpIssuer,
    idpCert: "",
    emailAttributes: initial.emailAttributes.join(", "),
    groupsAttributes: initial.groupsAttributes.join(", "),
    allowedDomains: initial.allowedDomains.join(", "),
    autoProvision: initial.autoProvision,
    defaultRole: initial.defaultRole,
    adminGroups: initial.adminGroups.join(", "),
    buttonLabel: initial.buttonLabel,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setMsg(null); };
  const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

  const save = async () => {
    const res = await fetch("/api/settings/saml", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...f,
        emailAttributes: list(f.emailAttributes),
        groupsAttributes: list(f.groupsAttributes),
        allowedDomains: list(f.allowedDomains),
        adminGroups: list(f.adminGroups),
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(typeof json.error === "string" ? json.error : "Check the fields and try again.");
    setMsg("Saved.");
    onSaved();
  };

  return (
    <Card className="rise rise-4">
      <h2 className="text-xl mb-1">Single sign-on — SAML</h2>
      <p className="text-sm text-ink-soft mb-4">
        For identity providers that use SAML 2.0, such as <b>PingFederate / PingOne</b> (PingID multi-factor is enforced by Ping
        during sign-in), ADFS, Okta or Shibboleth. Give your IdP team the service-provider details below or the metadata URL.
        {initial.source === "env" && " Currently configured from SAML_* environment variables."}
      </p>
      <div className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm mb-4">
        <span className="text-ink-soft">Entity ID</span><code className="figure text-xs break-all">{initial.spEntityId}</code>
        <span className="text-ink-soft">ACS URL (POST)</span><code className="figure text-xs break-all">{initial.acsUrl}</code>
        <span className="text-ink-soft">Metadata</span><a className="figure text-xs underline break-all" href={initial.metadataUrl}>{initial.metadataUrl}</a>
        <span className="text-ink-soft">Status</span>
        <span>{initial.configured ? <Badge tone="COMPLETED">active</Badge> : <Badge>not configured</Badge>}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="IdP sign-in URL (SSO service, redirect binding)">
          <input className={inputCls} value={f.entryPoint} onChange={(e) => set({ entryPoint: e.target.value })} placeholder="https://sso.example.com/idp/SSO.saml2" />
        </Field>
        <Field label="IdP entity ID (optional, recommended)">
          <input className={inputCls} value={f.idpIssuer} onChange={(e) => set({ idpIssuer: e.target.value })} placeholder="https://sso.example.com" />
        </Field>
      </div>
      <Field label="IdP signing certificate" hint={initial.cert ? `Current: ${initial.cert.subject} · expires ${initial.cert.validTo.slice(0, 10)}${initial.cert.expired ? " (EXPIRED)" : ""}. Leave blank to keep it.` : "Paste the PEM (or its base64 body) from your IdP's metadata."}>
        <textarea className={inputCls + " figure text-xs h-24"} value={f.idpCert} onChange={(e) => set({ idpCert: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----" />
      </Field>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Field label="Email attribute(s)" hint="First one present wins; else the NameID if it's an email">
          <input className={inputCls + " figure text-xs"} value={f.emailAttributes} onChange={(e) => set({ emailAttributes: e.target.value })} />
        </Field>
        <Field label="Groups attribute(s)">
          <input className={inputCls + " figure text-xs"} value={f.groupsAttributes} onChange={(e) => set({ groupsAttributes: e.target.value })} />
        </Field>
        <Field label="Admin groups" hint="Members become admins; everyone else is a user. Re-checked at every sign-in.">
          <input className={inputCls} value={f.adminGroups} onChange={(e) => set({ adminGroups: e.target.value })} placeholder="dispatch-admins" />
        </Field>
        <Field label="Allowed email domains (optional)">
          <input className={inputCls} value={f.allowedDomains} onChange={(e) => set({ allowedDomains: e.target.value })} placeholder="example.com" />
        </Field>
        <Field label="Login button label">
          <input className={inputCls} value={f.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} />
        </Field>
        <Field label="New users">
          <select className={inputCls} value={f.autoProvision ? f.defaultRole : "invite"} onChange={(e) => set(e.target.value === "invite" ? { autoProvision: false } : { autoProvision: true, defaultRole: e.target.value as "USER" | "ADMIN" })}>
            <option value="invite">Only invited people can sign in</option>
            <option value="USER">Create an account on first sign-in (user)</option>
            <option value="ADMIN">Create an account on first sign-in (admin)</option>
          </select>
        </Field>
      </div>
      <div className="flex items-center gap-3 mt-4">
        <Button onClick={save} disabled={!f.entryPoint || (!f.idpCert && !initial.cert)}>Save SAML settings</Button>
        {initial.configured && initial.source === "settings" && (
          <Button variant="danger" onClick={async () => { if (confirm("Turn off SAML sign-in?")) { await fetch("/api/settings/saml", { method: "DELETE" }); onSaved(); } }}>
            Remove
          </Button>
        )}
        {initial.configured && <a className="text-sm underline" href="/api/auth/sso/saml/start">Test sign-in</a>}
        {msg && <span className="text-sm text-ink-soft" role="status">{msg}</span>}
      </div>
    </Card>
  );
}

function SsoPanel() {
  const { data, refresh } = useFetch<SsoForm>("/api/settings/sso");
  if (!data) return null;
  return <SsoFormView key={data.issuer + data.clientId} initial={data} onSaved={refresh} />;
}

function SsoFormView({ initial, onSaved }: { initial: SsoForm; onSaved: () => void }) {
  const [f, setF] = useState({
    issuer: initial.issuer,
    clientId: initial.clientId,
    clientSecret: "",
    allowedDomains: initial.allowedDomains.join(", "),
    autoProvision: initial.autoProvision,
    defaultRole: initial.defaultRole,
    adminGroups: initial.adminGroups.join(", "),
    buttonLabel: initial.buttonLabel,
  });
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setSaved(false); };
  const list = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

  const save = async () => {
    setErr(null);
    const res = await fetch("/api/settings/sso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, clientSecret: f.clientSecret || undefined, allowedDomains: list(f.allowedDomains), adminGroups: list(f.adminGroups) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
    setSaved(true);
    onSaved();
  };

  return (
    <Card className="rise rise-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl">Single sign-on (OIDC)</h2>
        <Badge tone={initial.configured ? "COMPLETED" : "FAILED"}>{initial.configured ? `on · ${initial.source}` : "not configured"}</Badge>
      </div>
      <p className="text-sm text-ink-soft mb-4">
        Okta, Microsoft Entra ID, Google Workspace, or any OpenID Connect provider. Register this redirect URI with the provider:{" "}
        <span className="figure text-xs select-all break-all">{initial.redirectUri}</span>
      </p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Issuer URL" hint="e.g. https://login.microsoftonline.com/<tenant>/v2.0">
          <input id="sso-issuer" className={inputCls + " figure text-xs"} value={f.issuer} onChange={(e) => set({ issuer: e.target.value })} />
        </Field>
        <Field label="Client ID">
          <input id="sso-client" className={inputCls + " figure text-xs"} value={f.clientId} onChange={(e) => set({ clientId: e.target.value })} />
        </Field>
        <Field label="Client secret" hint={initial.hasSecret ? "A secret is stored; leave blank to keep it" : undefined}>
          <input id="sso-secret" type="password" className={inputCls + " figure text-xs"} value={f.clientSecret} onChange={(e) => set({ clientSecret: e.target.value })} />
        </Field>
        <Field label="Button label">
          <input id="sso-label" className={inputCls} value={f.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} />
        </Field>
        <Field label="Allowed email domains" hint="Comma-separated; blank = any">
          <input id="sso-domains" className={inputCls + " figure text-xs"} value={f.allowedDomains} onChange={(e) => set({ allowedDomains: e.target.value })} placeholder="example.com" />
        </Field>
        <Field label="Admin groups" hint="IdP groups claim values that grant admin; re-checked at each sign-in">
          <input id="sso-admins" className={inputCls + " figure text-xs"} value={f.adminGroups} onChange={(e) => set({ adminGroups: e.target.value })} placeholder="dispatch-admins" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm mb-4">
        <input type="checkbox" checked={f.autoProvision} onChange={(e) => set({ autoProvision: e.target.checked })} />
        Create an account on first sign-in, as
        <select className={inputCls + " w-auto py-1"} aria-label="Default role for new SSO users" value={f.defaultRole} onChange={(e) => set({ defaultRole: e.target.value as "USER" | "ADMIN" })}>
          <option value="USER">user</option>
          <option value="ADMIN">admin</option>
        </select>
      </label>
      {err && <div className="text-accent text-sm mb-3">{err}</div>}
      <div className="flex gap-3 items-center">
        <Button onClick={save} disabled={!f.issuer || !f.clientId || (!f.clientSecret && !initial.hasSecret)}>Save single sign-on</Button>
        {saved && <span className="text-sm text-good">Saved</span>}
        {initial.source === "settings" && (
          <Button variant="danger" small onClick={async () => { await fetch("/api/settings/sso", { method: "DELETE" }); onSaved(); }}>Remove</Button>
        )}
      </div>
    </Card>
  );
}
