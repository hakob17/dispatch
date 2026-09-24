"use client";

export interface PreviewableTemplate {
  channel: string;
  subject?: string | null;
  htmlBody?: string | null;
  pushTitle?: string | null;
  pushBody?: string | null;
  pushUrl?: string | null;
  pushImageUrl?: string | null;
  inAppLayout?: string | null;
  inAppButtons?: { label: string; url: string }[] | null;
  cardStyle?: string | null;
  cardPinned?: boolean;
  cardCategory?: string | null;
  smsBody?: string | null;
  whatsappContentSid?: string | null;
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
    .replace(/\{\{\s*attributes\.(\w+)\s*\}\}/g, "$1")
    .replace(/\{\{\s*(?:recommendation|trending)\.(\d+)\.title\s*\}\}/g, "Recommended article $1")
    .replace(/\{\{\s*item\.title\s*\}\}/g, "New article headline")
    .replace(/\{\{\s*(?:recommendation\.\d+|trending\.\d+|item)\.(\w+)\s*\}\}/g, "[$1]");
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

  if (template.channel === "IN_APP") {
    const layout = template.inAppLayout ?? "MODAL";
    const buttons = (template.inAppButtons ?? []).filter((b) => b.label);
    const card = (
      <div className="bg-paper-raised border border-line-strong shadow-sm overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {template.pushImageUrl && <img src={template.pushImageUrl} alt="" className="w-full max-h-40 object-cover" />}
        <div className="p-4">
          <div className="font-medium">{sample(template.pushTitle || "Message title")}</div>
          <div className="text-sm text-ink-soft mt-1 whitespace-pre-line">{sample(template.pushBody || "Message body…")}</div>
          {buttons.length > 0 && (
            <div className="flex gap-2 mt-3">
              {buttons.map((b, i) => (
                <span key={i} className={`text-xs px-3 py-1.5 ${i === 0 ? "bg-ink text-paper" : "border border-line-strong"}`}>{sample(b.label)}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
    return (
      <div className="card p-4 max-w-sm">
        <div className="figure text-[10px] uppercase tracking-wider text-ink-faint mb-2">
          {layout === "INBOX" ? "message centre only" : `${layout.toLowerCase()} · also kept in the message centre`}
        </div>
        <div className={`bg-paper-sunken p-3 min-h-[14rem] flex ${layout === "BANNER" ? "items-start" : "items-center"}`}>
          <div className={layout === "BANNER" ? "w-full scale-95 origin-top" : "w-full"}>{card}</div>
        </div>
      </div>
    );
  }

  if (template.channel === "CONTENT_CARD") {
    const style = template.cardStyle ?? "CLASSIC";
    const img = template.pushImageUrl && !/\{\{/.test(template.pushImageUrl) ? template.pushImageUrl : null;
    const button = template.inAppButtons?.[0]?.label;
    const other = (
      <div className="bg-paper-raised border border-line p-3 text-xs text-ink-faint">Older card · Tech Weekly: chips rally…</div>
    );
    const card =
      style === "BANNER" ? (
        <div className="bg-paper-raised border border-line-strong overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {img ? <img src={img} alt="" className="w-full h-28 object-cover" /> : <div className="h-28 bg-line flex items-center justify-center text-xs text-ink-faint">banner image</div>}
        </div>
      ) : (
        <div className={`bg-paper-raised border border-line-strong overflow-hidden ${style === "CLASSIC" ? "flex gap-3 p-3" : ""}`}>
          {style === "CAPTIONED_IMAGE" &&
            (img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="" className="w-full h-32 object-cover" />
            ) : (
              <div className="h-32 bg-line" />
            ))}
          {style === "CLASSIC" &&
            (img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt="" className="w-14 h-14 object-cover shrink-0" />
            ) : (
              <div className="w-14 h-14 bg-line shrink-0" />
            ))}
          <div className={style === "CAPTIONED_IMAGE" ? "p-3" : "min-w-0"}>
            <div className="text-sm font-medium">{sample(template.pushTitle || "Card title")}</div>
            <div className="text-xs text-ink-soft mt-0.5 whitespace-pre-line">{sample(template.pushBody || "Card text…")}</div>
            {button && <div className="text-xs text-accent font-medium mt-2">{sample(button)} →</div>}
          </div>
        </div>
      );
    return (
      <div className="card p-4 max-w-sm">
        <div className="figure text-[10px] uppercase tracking-wider text-ink-faint mb-2">
          card feed{template.cardCategory ? ` · ${template.cardCategory}` : ""}{template.cardPinned ? " · pinned" : ""}
        </div>
        <div className="bg-paper-sunken p-3 space-y-2">
          {template.cardPinned ? (
            <>
              <div className="relative">
                <span className="absolute -top-1.5 right-2 figure text-[9px] bg-ink text-paper px-1">PINNED</span>
                {card}
              </div>
              {other}
            </>
          ) : (
            <>
              {card}
              {other}
            </>
          )}
        </div>
      </div>
    );
  }

  if (template.channel === "SMS" || template.channel === "WHATSAPP") {
    const wa = template.channel === "WHATSAPP";
    return (
      <div className="card p-4 max-w-sm">
        <div className="figure text-[10px] uppercase tracking-wider text-ink-faint mb-2">{wa ? "WhatsApp" : "SMS"}</div>
        <div className={`p-3 min-h-[8rem] ${wa ? "bg-[#e5ddd5]" : "bg-paper-sunken"}`}>
          <div className={`max-w-[85%] px-3 py-2 text-sm whitespace-pre-line rounded-lg ${wa ? "bg-white" : "bg-paper-raised border border-line"}`}>
            {wa && template.whatsappContentSid ? <span className="text-ink-soft">Approved template {template.whatsappContentSid}</span> : sample(template.smsBody || "Your message…")}
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
