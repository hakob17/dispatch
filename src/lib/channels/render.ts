import type { Channel, Contact, MessageTemplate, PushSubscription } from "@prisma/client";
import { db } from "../db";
import { renderEmail } from "./email/render";
import { contactVars, interpolate, type TemplateVars } from "../template";
import { clickUrl } from "../tracking/links";
import type { PushOptions, RenderedMessage } from "./types";
import { localize } from "../localize";

interface RenderInput {
  template: MessageTemplate;
  contact: Contact;
  messageId: string;
  subscription?: Pick<PushSubscription, "endpoint" | "keys"> | null;
  track?: boolean;
  /** extra {{vars}}: recommendations, the article a feed send is about, … */
  extraVars?: TemplateVars;
  /** The message's channel when it differs from the template's (one push template sent to iOS, Android and web) */
  channel?: Channel;
}

/** Expand {{content_block.<name>}} includes (one level, before variable interpolation). */
export async function expandContentBlocks(html: string): Promise<string> {
  const names = [...html.matchAll(/\{\{\s*content_block\.([\w-]+)\s*\}\}/g)].map((m) => m[1]);
  if (!names.length) return html;
  const blocks = await db.contentBlock.findMany({ where: { name: { in: [...new Set(names)] } } });
  const map = new Map(blocks.map((b) => [b.name, b.content]));
  return html.replace(/\{\{\s*content_block\.([\w-]+)\s*\}\}/g, (_, name: string) => map.get(name) ?? "");
}

function pushOptions(template: MessageTemplate, vars: TemplateVars): PushOptions {
  const data: Record<string, string> = {};
  if (template.pushData && typeof template.pushData === "object") {
    for (const [k, v] of Object.entries(template.pushData as Record<string, unknown>)) {
      data[k] = interpolate(String(v ?? ""), vars);
    }
  }
  return {
    priority: template.pushPriority === "NORMAL" ? "NORMAL" : "HIGH",
    collapseKey: template.pushCollapseKey ? interpolate(template.pushCollapseKey, vars) : undefined,
    ttlSeconds: template.pushTtlSeconds ?? undefined,
    imageUrl: template.pushImageUrl ? interpolate(template.pushImageUrl, vars) : undefined,
    data: Object.keys(data).length ? data : undefined,
  };
}

/** Render any channel's template for one recipient. */
export async function renderMessage({ template: base, contact, messageId, subscription, track = true, extraVars, channel }: RenderInput): Promise<RenderedMessage> {
  const localized = localize(base, contact.language);
  // Push templates are platform-neutral: render for the device's provider
  const isPushChannel = (c: Channel) => c === "FCM" || c === "APNS" || c === "WEB_PUSH";
  const template = channel && isPushChannel(channel) && isPushChannel(localized.channel) ? { ...localized, channel } : localized;
  const vars = { ...contactVars(contact), ...(extraVars ?? {}) };

  switch (template.channel) {
    case "EMAIL": {
      const expanded = template.htmlBody?.includes("content_block")
        ? { ...template, htmlBody: await expandContentBlocks(template.htmlBody) }
        : template;
      return renderEmail({ template: expanded, contact, messageId, track, extraVars });
    }

    case "WEB_PUSH":
    case "FCM":
    case "APNS": {
      const rawUrl = interpolate(template.pushUrl || "/", vars);
      // Web push clicks go through the click-tracking redirect. Mobile push keeps
      // the raw link so custom schemes / universal links open the app directly;
      // opens are reported by the SDK instead.
      const wrap = track && template.channel === "WEB_PUSH" && /^https?:\/\//.test(rawUrl);
      return {
        messageId,
        channel: template.channel,
        pushTitle: interpolate(template.pushTitle || "", vars),
        pushBody: interpolate(template.pushBody || "", vars),
        pushUrl: wrap ? clickUrl(messageId, rawUrl) : rawUrl,
        push: pushOptions(template, vars),
        subscription: subscription
          ? { endpoint: subscription.endpoint, keys: subscription.keys as { p256dh: string; auth: string } | null }
          : undefined,
      };
    }

    case "IN_APP": {
      const layout = (["MODAL", "BANNER", "FULLSCREEN", "INBOX"] as const).find((l) => l === template.inAppLayout) ?? "MODAL";
      const buttons = Array.isArray(template.inAppButtons) ? (template.inAppButtons as { label?: string; url?: string }[]) : [];
      const url = template.pushUrl ? interpolate(template.pushUrl, vars) : null;
      return {
        messageId,
        channel: "IN_APP",
        inApp: {
          layout,
          title: interpolate(template.pushTitle || "", vars),
          body: interpolate(template.pushBody || "", vars),
          imageUrl: template.pushImageUrl ? interpolate(template.pushImageUrl, vars) : null,
          buttons: buttons
            .filter((b) => b.label)
            .slice(0, 2)
            .map((b) => ({ label: interpolate(b.label!, vars), url: interpolate(b.url ?? "", vars) })),
          url: url || null,
        },
      };
    }

    case "CONTENT_CARD": {
      const style = (["CLASSIC", "CAPTIONED_IMAGE", "BANNER"] as const).find((x) => x === template.cardStyle) ?? "CLASSIC";
      const buttons = Array.isArray(template.inAppButtons) ? (template.inAppButtons as { label?: string }[]) : [];
      const url = template.pushUrl ? interpolate(template.pushUrl, vars) : null;
      return {
        messageId,
        channel: "CONTENT_CARD",
        card: {
          style,
          title: interpolate(template.pushTitle || "", vars),
          body: interpolate(template.pushBody || "", vars),
          imageUrl: template.pushImageUrl ? interpolate(template.pushImageUrl, vars) || null : null,
          url: url || null,
          buttonLabel: buttons[0]?.label ? interpolate(buttons[0].label, vars) : null,
          pinned: template.cardPinned,
          dismissible: template.cardDismissible,
          category: template.cardCategory || null,
        },
      };
    }

    case "SMS":
    case "WHATSAPP": {
      const vars2 = template.whatsappVariables as Record<string, string> | null;
      return {
        messageId,
        channel: template.channel,
        to: contact.phone ?? undefined,
        smsBody: interpolate(template.smsBody || template.pushBody || "", vars),
        ...(template.channel === "WHATSAPP" && template.whatsappContentSid
          ? {
              whatsappContentSid: template.whatsappContentSid,
              whatsappVariables: Object.fromEntries(Object.entries(vars2 ?? {}).map(([k, v]) => [k, interpolate(String(v), vars)])),
            }
          : {}),
      };
    }

    case "WEBHOOK":
      return {
        messageId,
        channel: "WEBHOOK",
        webhookUrl: interpolate(template.webhookUrl || "", vars),
        webhookBody: interpolate(template.webhookBody || "{}", vars),
      };

    default:
      return { messageId, channel: template.channel };
  }
}
