import { createHmac, timingSafeEqual } from "node:crypto";
import type { Channel } from "@prisma/client";
import { getSetting } from "../../settings";
import type { ChannelAdapter, RenderedMessage, SendResult } from "../types";
import { normalizePhone } from "./text";

export { normalizePhone, smsSegments } from "./text";

/**
 * SMS and WhatsApp through Twilio's Messages API.
 *
 *   SMS       From = a Messaging Service (recommended: sender pool, STOP handling, queueing) or a number
 *   WhatsApp  From = whatsapp:+<approved sender>. Outside the 24-hour customer-service window Meta
 *             only allows approved templates: set the template's WhatsApp Content SID + variables.
 *
 * Delivery status and inbound STOP/START arrive at /api/webhooks/twilio (signature-checked).
 * Config: Settings → SMS & WhatsApp, or TWILIO_* env vars (env wins).
 */
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid?: string;
  fromNumber?: string;
  whatsappFrom?: string;
}

export async function getTwilioConfig(): Promise<TwilioConfig | null> {
  const stored = (await getSetting<Partial<TwilioConfig>>("twilio")) ?? {};
  const cfg: Partial<TwilioConfig> = {
    accountSid: process.env.TWILIO_ACCOUNT_SID || stored.accountSid,
    authToken: process.env.TWILIO_AUTH_TOKEN || stored.authToken,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || stored.messagingServiceSid || undefined,
    fromNumber: process.env.TWILIO_FROM || stored.fromNumber || undefined,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || stored.whatsappFrom || undefined,
  };
  return cfg.accountSid && cfg.authToken ? (cfg as TwilioConfig) : null;
}

const smsReady = (c: TwilioConfig | null) => !!c && !!(c.messagingServiceSid || c.fromNumber);
const whatsappReady = (c: TwilioConfig | null) => !!c && !!c.whatsappFrom;

/** Twilio's request signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const got = Buffer.from(header);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const statusCallbackUrl = () => `${(process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "")}/api/webhooks/twilio`;

/** Twilio error codes that won't succeed on retry (bad/blocked number, opted out, region not enabled). */
const PERMANENT = new Set([21211, 21212, 21214, 21217, 21219, 21408, 21610, 21612, 21614, 21635, 63003, 63016]);

/** Build the Messages API form for one message. Exported for tests. */
export function twilioForm(cfg: TwilioConfig, m: RenderedMessage): URLSearchParams | { error: string } {
  const to = normalizePhone(m.to);
  if (!to) return { error: "no valid phone number (E.164)" };
  const form = new URLSearchParams({ StatusCallback: statusCallbackUrl() });
  if (m.channel === "WHATSAPP") {
    if (!cfg.whatsappFrom) return { error: "WhatsApp sender not configured" };
    form.set("To", `whatsapp:${to}`);
    form.set("From", cfg.whatsappFrom.startsWith("whatsapp:") ? cfg.whatsappFrom : `whatsapp:${cfg.whatsappFrom}`);
    if (m.whatsappContentSid) {
      form.set("ContentSid", m.whatsappContentSid);
      if (m.whatsappVariables && Object.keys(m.whatsappVariables).length) form.set("ContentVariables", JSON.stringify(m.whatsappVariables));
    } else form.set("Body", m.smsBody ?? "");
  } else {
    form.set("To", to);
    if (cfg.messagingServiceSid) form.set("MessagingServiceSid", cfg.messagingServiceSid);
    else form.set("From", cfg.fromNumber!);
    form.set("Body", m.smsBody ?? "");
  }
  return form;
}

async function send(channel: Channel, m: RenderedMessage): Promise<SendResult> {
  const cfg = await getTwilioConfig();
  if (!cfg || (channel === "SMS" ? !smsReady(cfg) : !whatsappReady(cfg))) return { ok: false, error: `${channel} not configured`, permanent: true };
  const form = twilioForm(cfg, m);
  if ("error" in form) return { ok: false, error: form.error, permanent: true };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (res.ok && json.sid) return { ok: true, providerMessageId: json.sid };
    const code = json.code ?? res.status;
    return {
      ok: false,
      error: `Twilio ${code}: ${json.message ?? res.statusText}`.slice(0, 500),
      permanent: PERMANENT.has(code) || (res.status >= 400 && res.status < 500 && res.status !== 429),
    };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 500), permanent: false };
  }
}

export const smsAdapter: ChannelAdapter = {
  channel: "SMS",
  configHint: "Add your Twilio account SID, auth token and a Messaging Service (or number) under Settings → SMS & WhatsApp",
  isConfigured: async () => smsReady(await getTwilioConfig()),
  send: (m) => send("SMS", m),
};

export const whatsappAdapter: ChannelAdapter = {
  channel: "WHATSAPP",
  configHint: "Add your Twilio account and an approved WhatsApp sender under Settings → SMS & WhatsApp",
  isConfigured: async () => whatsappReady(await getTwilioConfig()),
  send: (m) => send("WHATSAPP", m),
};
