import type { Contact, MessageTemplate, PushSubscription } from "@prisma/client";
import { db } from "../db";
import { renderEmail } from "./email/render";
import { contactVars, interpolate } from "../template";
import { clickUrl } from "../tracking/links";
import type { RenderedMessage } from "./types";

interface RenderInput {
  template: MessageTemplate;
  contact: Contact;
  messageId: string;
  subscription?: Pick<PushSubscription, "endpoint" | "keys"> | null;
  track?: boolean;
}

/** Expand {{content_block.<name>}} includes (one level, before variable interpolation). */
export async function expandContentBlocks(html: string): Promise<string> {
  const names = [...html.matchAll(/\{\{\s*content_block\.([\w-]+)\s*\}\}/g)].map((m) => m[1]);
  if (!names.length) return html;
  const blocks = await db.contentBlock.findMany({ where: { name: { in: [...new Set(names)] } } });
  const map = new Map(blocks.map((b) => [b.name, b.content]));
  return html.replace(/\{\{\s*content_block\.([\w-]+)\s*\}\}/g, (_, name: string) => map.get(name) ?? "");
}

/** Render any channel's template for one recipient. */
export async function renderMessage({ template, contact, messageId, subscription, track = true }: RenderInput): Promise<RenderedMessage> {
  const vars = contactVars(contact);

  switch (template.channel) {
    case "EMAIL": {
      const expanded = template.htmlBody?.includes("content_block")
        ? { ...template, htmlBody: await expandContentBlocks(template.htmlBody) }
        : template;
      return renderEmail({ template: expanded, contact, messageId, track });
    }

    case "WEB_PUSH":
    case "FCM":
    case "APNS": {
      const rawUrl = interpolate(template.pushUrl || "/", vars);
      return {
        messageId,
        channel: template.channel,
        pushTitle: interpolate(template.pushTitle || "", vars),
        pushBody: interpolate(template.pushBody || "", vars),
        // Route push clicks through click tracking (http(s) URLs only)
        pushUrl: track && /^https?:\/\//.test(rawUrl) ? clickUrl(messageId, rawUrl) : rawUrl,
        subscription: subscription
          ? { endpoint: subscription.endpoint, keys: subscription.keys as { p256dh: string; auth: string } | null }
          : undefined,
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
