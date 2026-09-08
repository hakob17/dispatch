"use client";

export interface PreviewableTemplate {
  channel: string;
  subject?: string | null;
  htmlBody?: string | null;
  pushTitle?: string | null;
  pushBody?: string | null;
  pushUrl?: string | null;
  webhookUrl?: string | null;
  webhookBody?: string | null;
}

/** Substitute sample values so previews look like a real message. */
function sample(s: string): string {
  return s
    .replace(/\{\{\s*firstName\s*\}\}/g, "Alex")
    .replace(/\{\{\s*lastName\s*\}\}/g, "Rivera")
    .replace(/\{\{\s*email\s*\}\}/g, "alex@example.com")
    .replace(/\{\{\s*unsubscribeUrl\s*\}\}/g, "#")
    .replace(/\{\{\s*attributes\.(\w+)\s*\}\}/g, "$1");
}

/** Per-channel visual preview of a template's content. */
export default function TemplatePreview({
  template,
  height = 480,
}: {
  template: PreviewableTemplate;
  height?: number;
}) {
  const isPush = ["WEB_PUSH", "FCM", "APNS"].includes(template.channel);

  if (template.channel === "EMAIL") {
    return (
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-2.5 text-sm">
          <span className="text-ink-faint">Subject: </span>
          <span className="font-medium">{sample(template.subject || "(no subject)")}</span>
        </div>
        <iframe
          title="preview"
          className="w-full bg-white"
          style={{ height }}
          sandbox=""
          srcDoc={sample(template.htmlBody || "")}
        />
      </div>
    );
  }

  if (isPush) {
    return (
      <div className="card p-4 max-w-sm">
        <div className="flex gap-3 items-start bg-paper-sunken p-3 rounded-lg">
          <div className="w-9 h-9 bg-accent text-paper flex items-center justify-center font-display text-lg shrink-0 rounded">D</div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{sample(template.pushTitle || "Notification title")}</div>
            <div className="text-xs text-ink-soft mt-0.5">{sample(template.pushBody || "Notification body…")}</div>
            <div className="figure text-[10px] text-ink-faint mt-1 truncate">{template.pushUrl || "https://…"}</div>
          </div>
        </div>
      </div>
    );
  }

  if (template.channel === "WEBHOOK") {
    return (
      <pre className="card p-4 figure text-xs overflow-auto">{`POST ${template.webhookUrl || "https://…"}\n\n${sample(template.webhookBody || "{}")}`}</pre>
    );
  }

  return <div className="card p-4 text-sm text-ink-faint">No preview for {template.channel}.</div>;
}
