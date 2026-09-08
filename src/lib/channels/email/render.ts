import type { MessageTemplate } from "@prisma/client";
import { contactVars, interpolate, TemplateVars } from "../../template";
import { injectPixel, wrapLinks } from "../../tracking/links";
import { makeUnsubToken } from "../../tracking/sign";
import type { RenderedMessage } from "../types";

const base = () => process.env.APP_BASE_URL || "http://localhost:3000";

/** Crude but effective HTML → plain text for the alternative part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface EmailRenderInput {
  template: Pick<MessageTemplate, "subject" | "htmlBody" | "textBody">;
  contact: { id: string; email: string | null; firstName: string | null; lastName: string | null; attributes: unknown };
  messageId: string;
  /** false for test sends (no tracking, no unsub) */
  track?: boolean;
}

/**
 * Render an email: interpolate vars, wrap links for click tracking, inject open
 * pixel, ensure a visible unsubscribe footer, and produce the plain-text part.
 */
export function renderEmail({ template, contact, messageId, track = true }: EmailRenderInput): RenderedMessage {
  const unsubUrl = `${base()}/u/${makeUnsubToken(contact.id, messageId)}`;
  const vars: TemplateVars = {
    ...contactVars(contact as never),
    unsubscribeUrl: unsubUrl,
  };

  const subject = interpolate(template.subject || "", vars);
  let html = interpolate(template.htmlBody || "", vars);
  let text = template.textBody ? interpolate(template.textBody, vars) : htmlToText(html);

  if (track) {
    // Visible unsubscribe footer if the template didn't place one itself
    if (!(template.htmlBody || "").includes("{{unsubscribeUrl}}")) {
      const footer = `<p style="font-size:12px;color:#888;margin-top:32px">You are receiving this because you subscribed. <a href="${unsubUrl}">Unsubscribe</a></p>`;
      html = html.includes("</body>") ? html.replace("</body>", `${footer}</body>`) : html + footer;
      text += `\n\n--\nUnsubscribe: ${unsubUrl}`;
    }
    html = wrapLinks(html, messageId, [unsubUrl]);
    html = injectPixel(html, messageId);
  }

  return {
    messageId,
    channel: "EMAIL",
    to: contact.email ?? undefined,
    subject,
    html,
    text,
    unsubUrl: track ? unsubUrl : undefined,
  };
}
