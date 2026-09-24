"use client";

import { useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import TemplatePreview from "@/components/TemplatePreview";
import { smsSegments } from "@/lib/channels/sms/text";

export interface TemplateData {
  name: string;
  channel: string;
  tags?: string[];
  subject?: string | null;
  htmlBody?: string | null;
  textBody?: string | null;
  pushTitle?: string | null;
  pushBody?: string | null;
  pushUrl?: string | null;
  pushImageUrl?: string | null;
  pushPriority?: "HIGH" | "NORMAL";
  pushCollapseKey?: string | null;
  pushTtlSeconds?: number | null;
  pushData?: Record<string, string> | null;
  translations?: Record<string, Record<string, string>> | null;
  inAppLayout?: "MODAL" | "BANNER" | "FULLSCREEN" | "INBOX" | null;
  inAppButtons?: { label: string; url: string }[] | null;
  inAppExpiresHours?: number | null;
  cardStyle?: "CLASSIC" | "CAPTIONED_IMAGE" | "BANNER" | null;
  cardPinned?: boolean;
  cardCategory?: string | null;
  cardDismissible?: boolean;
  smsBody?: string | null;
  whatsappContentSid?: string | null;
  whatsappVariables?: Record<string, string> | null;
  webhookUrl?: string | null;
  webhookBody?: string | null;
}

const CHANNELS = ["EMAIL", "WEB_PUSH", "FCM", "APNS", "IN_APP", "CONTENT_CARD", "SMS", "WHATSAPP", "WEBHOOK"];

/** "key=value" lines ⇄ object, for the custom push data field. */
const dataToText = (d?: Record<string, string> | null) =>
  Object.entries(d ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
const textToData = (t: string): Record<string, string> | null => {
  const out: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : null;
};

export default function TemplateEditor({
  initial,
  channelLocked,
  onSave,
  saving,
}: {
  initial?: Partial<TemplateData>;
  channelLocked?: boolean;
  onSave: (data: TemplateData) => void;
  saving?: boolean;
}) {
  const [t, setT] = useState<TemplateData>({
    name: initial?.name ?? "",
    channel: initial?.channel ?? "EMAIL",
    subject: initial?.subject ?? "",
    htmlBody: initial?.htmlBody ?? "<html><body>\n  <h1>Hello {{firstName}}!</h1>\n  <p>Your message here.</p>\n</body></html>",
    textBody: initial?.textBody ?? "",
    pushTitle: initial?.pushTitle ?? "",
    pushBody: initial?.pushBody ?? "",
    pushUrl: initial?.pushUrl ?? "",
    pushImageUrl: initial?.pushImageUrl ?? "",
    pushPriority: initial?.pushPriority ?? "HIGH",
    pushCollapseKey: initial?.pushCollapseKey ?? "",
    pushTtlSeconds: initial?.pushTtlSeconds ?? null,
    pushData: initial?.pushData ?? null,
    translations: initial?.translations ?? null,
    inAppLayout: initial?.inAppLayout ?? "MODAL",
    inAppButtons: initial?.inAppButtons ?? [],
    inAppExpiresHours: initial?.inAppExpiresHours ?? null,
    cardStyle: initial?.cardStyle ?? "CLASSIC",
    cardPinned: initial?.cardPinned ?? false,
    cardCategory: initial?.cardCategory ?? "",
    cardDismissible: initial?.cardDismissible ?? true,
    smsBody: initial?.smsBody ?? "",
    whatsappContentSid: initial?.whatsappContentSid ?? "",
    whatsappVariables: initial?.whatsappVariables ?? null,
    webhookUrl: initial?.webhookUrl ?? "",
    webhookBody: initial?.webhookBody ?? '{"email": "{{email}}", "event": "campaign_message"}',
  });
  const set = (patch: Partial<TemplateData>) => setT((cur) => ({ ...cur, ...patch }));
  const [dataText, setDataText] = useState(dataToText(initial?.pushData));
  const isPush = ["WEB_PUSH", "FCM", "APNS"].includes(t.channel);

  return (
    <div className="grid grid-cols-2 gap-6">
      <div className="card p-5 rise space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Template name">
            <input className={inputCls} value={t.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Channel">
            <select
              className={inputCls}
              value={t.channel}
              disabled={channelLocked}
              onChange={(e) => set({ channel: e.target.value })}
            >
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        {t.channel === "EMAIL" && (
          <>
            <Field label="Subject">
              <input className={inputCls} value={t.subject ?? ""} onChange={(e) => set({ subject: e.target.value })} placeholder="Welcome, {{firstName}}!" />
            </Field>
            <Field label="HTML body" hint="Variables: {{firstName}}, {{email}}, {{attributes.x}}, {{unsubscribeUrl}}. An unsubscribe footer is added automatically if you omit {{unsubscribeUrl}}.">
              <textarea className={inputCls + " figure text-xs h-64"} value={t.htmlBody ?? ""} onChange={(e) => set({ htmlBody: e.target.value })} />
            </Field>
            <Field label="Plain-text body (optional)" hint="Derived from HTML if left blank — always sent as the text/plain part.">
              <textarea className={inputCls + " figure text-xs h-24"} value={t.textBody ?? ""} onChange={(e) => set({ textBody: e.target.value })} />
            </Field>
          </>
        )}

        {isPush && (
          <>
            <Field label="Notification title">
              <input className={inputCls} value={t.pushTitle ?? ""} onChange={(e) => set({ pushTitle: e.target.value })} placeholder="Hey {{firstName}} 👋" />
            </Field>
            <Field label="Notification body">
              <textarea className={inputCls + " h-24"} value={t.pushBody ?? ""} onChange={(e) => set({ pushBody: e.target.value })} />
            </Field>
            <Field
              label={t.channel === "WEB_PUSH" ? "Click-through URL" : "Deep link"}
              hint={
                t.channel === "WEB_PUSH"
                  ? "Opens when the notification is clicked; clicks are tracked."
                  : "https:// universal/app link or custom scheme (myapp://article/123). Delivered as data.url — your app's navigation resolves it; opens are reported by the SDK."
              }
            >
              <input className={inputCls} value={t.pushUrl ?? ""} onChange={(e) => set({ pushUrl: e.target.value })} placeholder={t.channel === "WEB_PUSH" ? "https://…" : "myapp://article/{{attributes.articleId}}"} />
            </Field>
            <Field label="Image URL (optional)" hint="Rich notification image. iOS uses mutable-content — works with any Notification Service Extension, no vendor code required.">
              <input className={inputCls} value={t.pushImageUrl ?? ""} onChange={(e) => set({ pushImageUrl: e.target.value })} placeholder="https://cdn…/photo.jpg" />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Priority" hint="High wakes the device now (breaking news).">
                <select className={inputCls} value={t.pushPriority ?? "HIGH"} onChange={(e) => set({ pushPriority: e.target.value as "HIGH" | "NORMAL" })}>
                  <option value="HIGH">High — immediate</option>
                  <option value="NORMAL">Normal — battery-friendly</option>
                </select>
              </Field>
              <Field label="Collapse key" hint="Same key replaces the previous alert instead of stacking.">
                <input className={inputCls + " figure"} value={t.pushCollapseKey ?? ""} onChange={(e) => set({ pushCollapseKey: e.target.value })} placeholder="live-story-123" />
              </Field>
              <Field label="Expire after (seconds)" hint="Blank = provider default. Stale alerts are dropped.">
                <input
                  type="number"
                  min={0}
                  className={inputCls + " figure"}
                  value={t.pushTtlSeconds ?? ""}
                  onChange={(e) => set({ pushTtlSeconds: e.target.value === "" ? null : Number(e.target.value) })}
                  placeholder="3600"
                />
              </Field>
            </div>
            <Field label="Custom data (optional)" hint="key=value per line, delivered to the app with the notification. Variables allowed.">
              <textarea
                className={inputCls + " figure text-xs h-16"}
                value={dataText}
                onChange={(e) => {
                  setDataText(e.target.value);
                  set({ pushData: textToData(e.target.value) });
                }}
                placeholder={"section=world\narticleId={{attributes.articleId}}"}
              />
            </Field>
          </>
        )}

        {t.channel === "IN_APP" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Shown as" hint="Every in-app message also stays in the user's message centre">
                <select id="inapp-layout" className={inputCls} value={t.inAppLayout ?? "MODAL"} onChange={(e) => set({ inAppLayout: e.target.value as TemplateData["inAppLayout"] })}>
                  <option value="MODAL">Pop-up (modal)</option>
                  <option value="BANNER">Banner</option>
                  <option value="FULLSCREEN">Full screen</option>
                  <option value="INBOX">Message centre only</option>
                </select>
              </Field>
              <Field label="Remove from message centre after (hours)" hint="Blank = 30 days">
                <input id="inapp-expiry" type="number" min={1} className={inputCls + " figure"} value={t.inAppExpiresHours ?? ""} onChange={(e) => set({ inAppExpiresHours: e.target.value === "" ? null : Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Title">
              <input id="inapp-title" className={inputCls} value={t.pushTitle ?? ""} onChange={(e) => set({ pushTitle: e.target.value })} placeholder="Your weekly briefing is ready" />
            </Field>
            <Field label="Body" hint="Variables work here, including {{recommendation.1.title}}">
              <textarea id="inapp-body" className={inputCls + " h-24"} value={t.pushBody ?? ""} onChange={(e) => set({ pushBody: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Image URL (optional)">
                <input id="inapp-image" className={inputCls} value={t.pushImageUrl ?? ""} onChange={(e) => set({ pushImageUrl: e.target.value })} />
              </Field>
              <Field label="Link when tapped (optional)">
                <input id="inapp-url" className={inputCls} value={t.pushUrl ?? ""} onChange={(e) => set({ pushUrl: e.target.value })} placeholder="myapp://briefing" />
              </Field>
            </div>
            {[0, 1].map((i) => {
              const b = t.inAppButtons?.[i] ?? { label: "", url: "" };
              const setBtn = (patch: Partial<{ label: string; url: string }>) => {
                const next = [...(t.inAppButtons ?? [])];
                next[i] = { ...b, ...patch };
                set({ inAppButtons: next.filter((x, j) => j <= i || x.label) });
              };
              return (
                <div key={i} className="grid grid-cols-2 gap-4">
                  <Field label={`Button ${i + 1} label`}>
                    <input id={`inapp-btn-${i}`} className={inputCls} value={b.label} onChange={(e) => setBtn({ label: e.target.value })} placeholder={i === 0 ? "Read now" : "Later"} />
                  </Field>
                  <Field label={`Button ${i + 1} link`}>
                    <input id={`inapp-btn-url-${i}`} className={inputCls} value={b.url} onChange={(e) => setBtn({ url: e.target.value })} placeholder="myapp://…" />
                  </Field>
                </div>
              );
            })}
          </>
        )}

        {t.channel === "CONTENT_CARD" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Card style">
                <select id="card-style" className={inputCls} value={t.cardStyle ?? "CLASSIC"} onChange={(e) => set({ cardStyle: e.target.value as TemplateData["cardStyle"] })}>
                  <option value="CLASSIC">Classic — thumbnail, title, text</option>
                  <option value="CAPTIONED_IMAGE">Captioned image — large image on top</option>
                  <option value="BANNER">Banner — image only</option>
                </select>
              </Field>
              <Field label="Remove after (hours)" hint="Blank = 30 days">
                <input id="card-expiry" type="number" min={1} className={inputCls + " figure"} value={t.inAppExpiresHours ?? ""} onChange={(e) => set({ inAppExpiresHours: e.target.value === "" ? null : Number(e.target.value) })} />
              </Field>
            </div>
            <Field label="Title">
              <input id="card-title" className={inputCls} value={t.pushTitle ?? ""} onChange={(e) => set({ pushTitle: e.target.value })} placeholder="Election night: follow the count live" />
            </Field>
            <Field label="Text" hint="Variables work here, including {{recommendation.1.title}}">
              <textarea id="card-body" className={inputCls + " h-20"} value={t.pushBody ?? ""} onChange={(e) => set({ pushBody: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t.cardStyle === "BANNER" ? "Image URL" : "Image URL (optional)"}>
                <input id="card-image" className={inputCls} value={t.pushImageUrl ?? ""} onChange={(e) => set({ pushImageUrl: e.target.value })} />
              </Field>
              <Field label="Link when tapped">
                <input id="card-url" className={inputCls} value={t.pushUrl ?? ""} onChange={(e) => set({ pushUrl: e.target.value })} placeholder="myapp://live/election" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Button label (optional)">
                <input id="card-button" className={inputCls} value={t.inAppButtons?.[0]?.label ?? ""} onChange={(e) => set({ inAppButtons: e.target.value ? [{ label: e.target.value, url: t.pushUrl ?? "" }] : [] })} placeholder="Follow live" />
              </Field>
              <Field label="Feed category (optional)" hint="Apps can show one feed per category">
                <input id="card-category" className={inputCls + " figure"} value={t.cardCategory ?? ""} onChange={(e) => set({ cardCategory: e.target.value.toLowerCase() })} placeholder="live" />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" checked={!!t.cardPinned} onChange={(e) => set({ cardPinned: e.target.checked })} />
              Pinned — stays at the top of the feed
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" checked={t.cardDismissible !== false} onChange={(e) => set({ cardDismissible: e.target.checked })} />
              Readers can dismiss it
            </label>
          </>
        )}

        {(t.channel === "SMS" || t.channel === "WHATSAPP") && (
          <>
            <Field label={t.channel === "SMS" ? "Text message" : "Message (inside the 24-hour window)"} hint="Variables work here, e.g. {{firstName}}, {{item.title}}, {{recommendation.1.url}}">
              <textarea id="sms-body" className={inputCls + " h-28"} value={t.smsBody ?? ""} onChange={(e) => set({ smsBody: e.target.value })} placeholder="Breaking: {{item.title}} {{item.url}}" />
            </Field>
            {t.channel === "SMS" && (() => {
              const seg = smsSegments(t.smsBody ?? "");
              return (
                <div className={`figure text-xs ${seg.segments > 3 ? "text-accent" : "text-ink-soft"}`} role="status">
                  {seg.length} characters · {seg.encoding} · {seg.segments} SMS segment{seg.segments === 1 ? "" : "s"} per recipient (before variables)
                  {seg.encoding === "UCS-2" && " — emoji or accents switch to 70-character segments"}
                </div>
              );
            })()}
            {t.channel === "WHATSAPP" && (
              <>
                <Field label="Approved template — Twilio Content SID (optional)" hint="Required to start a conversation outside the 24-hour window. When set, it's sent instead of the message above.">
                  <input id="wa-sid" className={inputCls + " figure"} value={t.whatsappContentSid ?? ""} onChange={(e) => set({ whatsappContentSid: e.target.value.trim() })} placeholder="HX…" />
                </Field>
                <Field label="Template variables" hint={'One per line: 1={{firstName}}'}>
                  <textarea
                    id="wa-vars"
                    className={inputCls + " figure text-xs h-20"}
                    defaultValue={Object.entries(t.whatsappVariables ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
                    onChange={(e) => set({ whatsappVariables: textToData(e.target.value) })}
                    placeholder={"1={{firstName}}\n2={{item.title}}"}
                  />
                </Field>
              </>
            )}
          </>
        )}

        {t.channel === "WEBHOOK" && (
          <>
            <Field label="Destination URL">
              <input className={inputCls} value={t.webhookUrl ?? ""} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://hooks.example.com/…" />
            </Field>
            <Field label="JSON body template">
              <textarea className={inputCls + " figure text-xs h-40"} value={t.webhookBody ?? ""} onChange={(e) => set({ webhookBody: e.target.value })} />
            </Field>
          </>
        )}

        {(isPush || t.channel === "EMAIL" || t.channel === "IN_APP" || t.channel === "CONTENT_CARD") && (
          <Translations
            channel={t.channel}
            value={t.translations ?? {}}
            onChange={(translations) => set({ translations: Object.keys(translations).length ? translations : null })}
          />
        )}

        <Field label="Tags" hint="Comma-separated">
          <input
            className={inputCls}
            defaultValue={(initial?.tags ?? []).join(", ")}
            onChange={(e) => set({ tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
            placeholder="onboarding, promo"
          />
        </Field>

        <Button onClick={() => onSave(t)} disabled={!t.name || saving}>
          {saving ? "Saving…" : "Save template"}
        </Button>
      </div>

      <div className="rise rise-2">
        <div className="figure text-[11px] uppercase tracking-[0.18em] text-ink-soft mb-3">Live preview</div>
        <TemplatePreview template={t} />
      </div>
    </div>
  );
}

const TRANSLATED_FIELDS: Record<string, { key: string; label: string; area?: boolean }[]> = {
  push: [
    { key: "pushTitle", label: "Title" },
    { key: "pushBody", label: "Body", area: true },
    { key: "pushUrl", label: "Deep link / URL" },
    { key: "pushImageUrl", label: "Image URL" },
  ],
  email: [
    { key: "subject", label: "Subject" },
    { key: "htmlBody", label: "HTML body", area: true },
    { key: "textBody", label: "Plain-text body", area: true },
  ],
};

/** Per-language overrides; blank fields fall back to the default content above. */
function Translations({
  channel,
  value,
  onChange,
}: {
  channel: string;
  value: Record<string, Record<string, string>>;
  onChange: (v: Record<string, Record<string, string>>) => void;
}) {
  const langs = Object.keys(value);
  const [active, setActive] = useState<string | null>(langs[0] ?? null);
  const [draft, setDraft] = useState("");
  const fields = TRANSLATED_FIELDS[channel === "EMAIL" ? "email" : "push"]; // in-app reuses the push fields

  const add = () => {
    const tag = draft.trim().replace(/_/g, "-");
    if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(tag) || value[tag]) return;
    onChange({ ...value, [tag]: {} });
    setActive(tag);
    setDraft("");
  };
  const remove = (tag: string) => {
    const next = { ...value };
    delete next[tag];
    onChange(next);
    setActive(Object.keys(next)[0] ?? null);
  };
  const setField = (tag: string, key: string, v: string) => onChange({ ...value, [tag]: { ...value[tag], [key]: v } });

  return (
    <div className="border border-line p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="figure text-[11px] uppercase tracking-[0.15em] text-ink-soft">Translations</div>
        <div className="flex gap-2">
          <input
            id="translation-lang"
            className={inputCls + " w-28 py-1 figure text-xs"}
            placeholder="de, pt-BR…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <Button small variant="ghost" onClick={add} disabled={!draft.trim()}>Add language</Button>
        </div>
      </div>
      {!langs.length && (
        <p className="text-xs text-ink-faint">
          Contacts whose language matches get the translated text (pt-BR falls back to pt); everyone else gets the default above.
        </p>
      )}
      {langs.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {langs.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setActive(l)}
                className={`figure text-xs px-2 py-1 border ${active === l ? "border-ink bg-ink text-paper" : "border-line-strong text-ink-soft"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {active && value[active] && (
            <div className="space-y-2">
              {fields.map((f) => (
                <Field key={f.key} label={`${f.label} (${active})`}>
                  {f.area ? (
                    <textarea className={inputCls + " h-20 text-sm"} value={value[active][f.key] ?? ""} onChange={(e) => setField(active, f.key, e.target.value)} placeholder="Blank = use default" />
                  ) : (
                    <input className={inputCls} value={value[active][f.key] ?? ""} onChange={(e) => setField(active, f.key, e.target.value)} placeholder="Blank = use default" />
                  )}
                </Field>
              ))}
              <Button small variant="danger" onClick={() => remove(active)}>Remove {active}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
