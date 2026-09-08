import {
  SESv2Client,
  SendEmailCommand,
  GetAccountCommand,
} from "@aws-sdk/client-sesv2";
import { getSetting } from "../../settings";
import type { ChannelAdapter, RenderedMessage, SendResult } from "../types";

export interface SesConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  fromEmail: string;
  fromName?: string;
  configurationSet?: string;
  maxSendRate?: number; // msgs/sec override; 0/undefined = ask SES
}

/**
 * SES configuration: the Setting row (saved from the admin UI) wins;
 * env vars are the fallback. Returns null when incomplete.
 */
export async function getSesConfig(): Promise<SesConfig | null> {
  const stored = (await getSetting<Partial<SesConfig>>("ses")) ?? {};
  const cfg: Partial<SesConfig> = {
    accessKeyId: stored.accessKeyId || process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: stored.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY,
    region: stored.region || process.env.AWS_REGION || "us-east-1",
    fromEmail: stored.fromEmail || process.env.SES_FROM_EMAIL,
    fromName: stored.fromName ?? process.env.SES_FROM_NAME,
    configurationSet: stored.configurationSet ?? process.env.SES_CONFIGURATION_SET,
    maxSendRate: stored.maxSendRate ?? (Number(process.env.SES_MAX_SEND_RATE) || undefined),
  };
  if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.fromEmail) return null;
  return cfg as SesConfig;
}

// Client cache keyed by credentials+region so saving new keys takes effect
// without a restart.
let cachedClient: { key: string; client: SESv2Client } | null = null;

export function clientFor(cfg: SesConfig): SESv2Client {
  const key = `${cfg.accessKeyId}:${cfg.secretAccessKey.slice(-6)}:${cfg.region}`;
  if (cachedClient?.key !== key) {
    cachedClient = {
      key,
      client: new SESv2Client({
        region: cfg.region,
        credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      }),
    };
  }
  return cachedClient.client;
}

/** Max messages/sec: config override, else SES GetAccount quota (cached 5 min). */
let cachedRate: { value: number; at: number } | null = null;
export async function getMaxSendRate(): Promise<number> {
  const cfg = await getSesConfig();
  if (!cfg) return 1;
  if (cfg.maxSendRate && cfg.maxSendRate > 0) return cfg.maxSendRate;
  if (cachedRate && Date.now() - cachedRate.at < 300_000) return cachedRate.value;
  try {
    const acct = await clientFor(cfg).send(new GetAccountCommand({}));
    cachedRate = { value: acct.SendQuota?.MaxSendRate || 1, at: Date.now() };
  } catch {
    cachedRate = { value: 1, at: Date.now() };
  }
  return cachedRate.value;
}

const PERMANENT_ERRORS = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "AccountSuspendedException",
  "BadRequestException",
]);

export const sesAdapter: ChannelAdapter = {
  channel: "EMAIL",
  configHint: "Add AWS credentials + sender address on the Settings page (or via env vars)",
  async isConfigured() {
    return !!(await getSesConfig());
  },
  async send(msg: RenderedMessage): Promise<SendResult> {
    const cfg = await getSesConfig();
    if (!cfg) return { ok: false, error: "SES not configured", permanent: true };
    if (!msg.to) return { ok: false, error: "missing recipient", permanent: true };
    const from = cfg.fromName ? `${cfg.fromName} <${cfg.fromEmail}>` : cfg.fromEmail;

    const headers = msg.unsubUrl
      ? [
          {
            Name: "List-Unsubscribe",
            Value: `<mailto:${cfg.fromEmail}?subject=unsubscribe>, <${msg.unsubUrl}>`,
          },
          { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
        ]
      : undefined;

    try {
      const res = await clientFor(cfg).send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [msg.to] },
          ConfigurationSetName: cfg.configurationSet || undefined,
          Content: {
            Simple: {
              Subject: { Data: msg.subject || "", Charset: "UTF-8" },
              Body: {
                Html: { Data: msg.html || "", Charset: "UTF-8" },
                Text: { Data: msg.text || "", Charset: "UTF-8" },
              },
              Headers: headers,
            },
          },
        })
      );
      return { ok: true, providerMessageId: res.MessageId };
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const name = e.name || "UnknownError";
      return {
        ok: false,
        error: `${name}: ${e.message || ""}`.slice(0, 500),
        permanent: PERMANENT_ERRORS.has(name),
      };
    }
  },
};
