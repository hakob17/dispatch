import http2 from "node:http2";
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import type { ChannelAdapter, RenderedMessage, SendResult } from "../types";
import { getApnsConfig, type ApnsConfig } from "../../settings";

/**
 * Direct APNs over HTTP/2 with token (.p8) authentication.
 * One multiplexed connection per process; the provider JWT is refreshed every
 * 50 minutes (Apple rejects tokens older than 60).
 */
const HOSTS = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" };

let session: http2.ClientHttp2Session | null = null;
let sessionKey = "";
let jwt: { token: string; at: number; key: string } | null = null;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function providerToken(cfg: ApnsConfig): string {
  const key = `${cfg.teamId}:${cfg.keyId}`;
  if (jwt && jwt.key === key && Date.now() - jwt.at < 50 * 60_000) return jwt.token;
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(Date.now() / 1000) }));
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(cfg.privateKey),
    dsaEncoding: "ieee-p1363", // JOSE wants raw r||s, not DER
  });
  jwt = { token: `${header}.${claims}.${b64url(signature)}`, at: Date.now(), key };
  return jwt.token;
}

function getSession(cfg: ApnsConfig): http2.ClientHttp2Session {
  const host = cfg.production ? HOSTS.production : HOSTS.sandbox;
  if (session && !session.closed && !session.destroyed && sessionKey === host) return session;
  session?.close();
  session = http2.connect(host);
  sessionKey = host;
  session.on("error", () => {
    session = null;
  });
  session.on("goaway", () => {
    session = null;
  });
  session.unref(); // don't keep the worker alive just for this socket
  return session;
}

export function buildApnsPayload(msg: RenderedMessage): Record<string, unknown> {
  const o = msg.push;
  return {
    aps: {
      alert: { title: msg.pushTitle || "", body: msg.pushBody || "" },
      sound: "default",
      ...(o?.imageUrl ? { "mutable-content": 1 } : {}),
      ...(o?.collapseKey ? { "thread-id": o.collapseKey } : {}),
    },
    ...(o?.data ?? {}),
    url: msg.pushUrl || "/",
    messageId: msg.messageId,
    ...(o?.imageUrl ? { imageUrl: o.imageUrl } : {}),
  };
}

const DEAD_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);
const TRANSIENT_STATUSES = new Set([429, 500, 503]);

export interface ApnsResult {
  ok: boolean;
  status: number;
  apnsId?: string;
  error?: string;
  /** token is permanently invalid */
  deactivate?: boolean;
  /** worth retrying later */
  transient?: boolean;
}

/** One APNs request on the shared HTTP/2 session (used by alerts and Live Activities). */
export function apnsRequest(cfg: ApnsConfig, token: string, body: string, extraHeaders: Record<string, string>): Promise<ApnsResult> {
  const headers: http2.OutgoingHttpHeaders = {
    ":method": "POST",
    ":path": `/3/device/${token}`,
    authorization: `bearer ${providerToken(cfg)}`,
    "apns-topic": cfg.bundleId,
    "content-type": "application/json",
    ...extraHeaders,
  };
  return new Promise((resolve) => {
    let req: http2.ClientHttp2Stream;
    try {
      req = getSession(cfg).request(headers);
    } catch (err) {
      session = null;
      return resolve({ ok: false, status: 0, error: `apns-connect: ${String(err)}`, transient: true });
    }
    let status = 0;
    let apnsId = "";
    let data = "";
    req.setTimeout(15_000, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      resolve({ ok: false, status: 0, error: "apns timeout", transient: true });
    });
    req.on("response", (h) => {
      status = Number(h[":status"]);
      apnsId = String(h["apns-id"] ?? "");
    });
    req.setEncoding("utf8");
    req.on("data", (c) => (data += c));
    req.on("error", (err) => resolve({ ok: false, status: 0, error: `apns-stream: ${String(err)}`, transient: true }));
    req.on("end", () => {
      if (status === 200) return resolve({ ok: true, status, apnsId: apnsId || undefined });
      let reason = "";
      try {
        reason = JSON.parse(data).reason ?? "";
      } catch {}
      resolve({
        ok: false,
        status,
        error: `apns ${status}: ${reason || data}`.slice(0, 500),
        transient: TRANSIENT_STATUSES.has(status),
        deactivate: status === 410 || DEAD_REASONS.has(reason),
      });
    });
    req.end(body);
  });
}

async function sendOne(cfg: ApnsConfig, msg: RenderedMessage): Promise<SendResult> {
  const token = msg.subscription?.endpoint;
  if (!token) return { ok: false, error: "missing APNs token", permanent: true };
  const o = msg.push;
  const headers: Record<string, string> = {
    "apns-push-type": "alert",
    "apns-priority": o?.priority === "NORMAL" ? "5" : "10",
  };
  if (o?.collapseKey) headers["apns-collapse-id"] = o.collapseKey.slice(0, 64);
  if (o?.ttlSeconds !== undefined) headers["apns-expiration"] = String(Math.floor(Date.now() / 1000) + o.ttlSeconds);
  const r = await apnsRequest(cfg, token, JSON.stringify(buildApnsPayload(msg)), headers);
  return r.ok
    ? { ok: true, providerMessageId: r.apnsId }
    : { ok: false, error: r.error ?? "apns error", permanent: !r.transient, deactivateSubscription: r.deactivate };
}

export const apnsAdapter: ChannelAdapter = {
  channel: "APNS",
  configHint: "Add your APNs auth key (.p8), key ID, team ID and bundle ID on the Settings page (or APNS_* env vars)",
  async isConfigured() {
    return !!(await getApnsConfig());
  },
  async send(msg) {
    const cfg = await getApnsConfig();
    if (!cfg) return { ok: false, error: "APNs not configured", permanent: true };
    return sendOne(cfg, msg);
  },
  /** HTTP/2 multiplexing: run up to APNS_CONCURRENCY streams at once on one connection. */
  async sendBatch(msgs) {
    const cfg = await getApnsConfig();
    if (!cfg) return msgs.map(() => ({ ok: false, error: "APNs not configured", permanent: true }));
    const limit = Number(process.env.APNS_CONCURRENCY) || 200;
    const results: SendResult[] = new Array(msgs.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, msgs.length) }, async () => {
        while (next < msgs.length) {
          const i = next++;
          results[i] = await sendOne(cfg, msgs[i]);
        }
      })
    );
    return results;
  },
};
