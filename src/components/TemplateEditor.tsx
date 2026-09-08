"use client";

import { useState } from "react";
import { Button, Field, inputCls } from "@/components/ui";
import TemplatePreview from "@/components/TemplatePreview";

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
  webhookUrl?: string | null;
  webhookBody?: string | null;
}

const CHANNELS = ["EMAIL", "WEB_PUSH", "FCM", "WEBHOOK"];

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
    webhookUrl: initial?.webhookUrl ?? "",
    webhookBody: initial?.webhookBody ?? '{"email": "{{email}}", "event": "campaign_message"}',
  });
  const set = (patch: Partial<TemplateData>) => setT((cur) => ({ ...cur, ...patch }));
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
            <Field label="Click-through URL" hint="Opens when the notification is clicked; clicks are tracked.">
              <input className={inputCls} value={t.pushUrl ?? ""} onChange={(e) => set({ pushUrl: e.target.value })} placeholder="https://…" />
            </Field>
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
