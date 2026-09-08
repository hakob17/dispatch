"use client";

import { useState } from "react";
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
        <DeliveryRulesPanel />
        <SubscriptionGroupsPanel />
        <ApiKeysPanel />
        <TeamPanel />
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
        <Button onClick={save} disabled={busy || !accessKeyId || !secretAccessKey || !fromEmail}>
          {busy ? "Saving…" : "Save credentials"}
        </Button>
        <Button variant="danger" small onClick={clear}>Remove stored credentials</Button>
      </div>
      <p className="text-xs text-ink-faint">
        Keys are stored in the database (Setting table) and take effect immediately — no restart needed.
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
        Covers Android and iOS. Mobile apps register tokens via <span className="figure text-xs">POST /api/push/register-token</span>.
      </p>
      <input type="file" accept="application/json" className="text-sm" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
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

function SubscriptionGroupsPanel() {
  const { data, refresh } = useFetch<{ id: string; name: string; description: string | null; _count: { states: number; campaigns: number } }[]>("/api/subscription-groups");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const res = await fetch("/api/subscription-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (res.ok) {
      setName(""); setDescription(""); setErr(null);
      refresh();
    } else setErr((await res.json()).error);
  };

  return (
    <Card className="rise rise-3">
      <h2 className="text-xl mb-1">Subscription groups</h2>
      <p className="text-sm text-ink-soft mb-4">
        Opt-in categories shown on the email preference center. Campaigns tied to a group skip contacts who opted out of it.
      </p>
      {(data ?? []).map((g) => (
        <div key={g.id} className="flex items-center justify-between py-2 border-b border-line text-sm">
          <div>
            <span className="font-medium">{g.name}</span>
            {g.description && <span className="text-ink-faint ml-2 text-xs">{g.description}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="figure text-xs text-ink-faint">{g._count.states} opted out · {g._count.campaigns} campaigns</span>
            <Button small variant="danger" onClick={async () => {
              if (!confirm(`Delete group "${g.name}"?`)) return;
              await fetch(`/api/subscription-groups/${g.id}`, { method: "DELETE" });
              refresh();
            }}>delete</Button>
          </div>
        </div>
      ))}
      <div className="grid grid-cols-3 gap-3 mt-4">
        <input className={inputCls} placeholder="Group name (e.g. Newsletter)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Button onClick={add} disabled={!name}>Add group</Button>
      </div>
      {err && <div className="text-accent text-sm mt-2">{err}</div>}
    </Card>
  );
}

function ApiKeysPanel() {
  const { data, refresh } = useFetch<{
    keys: { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; requests30d: number }[];
    usage: { byEndpoint: Record<string, number>; total30d: number };
  }>("/api/settings/api-keys");
  const [name, setName] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const create = async () => {
    const res = await fetch("/api/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
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
        Protect <span className="figure text-xs">/api/track</span> and <span className="figure text-xs">/api/push/register-token</span>.
        While no keys exist the endpoints are open (dev mode); the first key turns authentication on.
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
        <input className={inputCls + " max-w-xs"} placeholder="Key name (e.g. website)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={create} disabled={!name}>Create key</Button>
      </div>
      <p className="figure text-[11px] text-ink-faint mt-3">
        curl -H &quot;Authorization: Bearer dk_…&quot; -H &quot;Content-Type: application/json&quot; -d &apos;{"{"}&quot;email&quot;:&quot;a@b.co&quot;,&quot;event&quot;:&quot;signup&quot;{"}"}&apos; {typeof window !== "undefined" ? window.location.origin : ""}/api/track
      </p>
    </Card>
  );
}

interface TeamUser { id: string; email: string; name: string | null; role: "ADMIN" | "USER"; createdAt: string }

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
              <td className="pr-4 text-ink-soft">{u.name ?? "—"}</td>
              <td className="pr-4"><Badge tone={u.role === "ADMIN" ? "RUNNING" : "QUEUED"}>{u.role}</Badge></td>
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
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "USER")}>
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
