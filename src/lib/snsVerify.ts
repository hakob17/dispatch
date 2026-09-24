import { createVerify } from "node:crypto";

/**
 * Amazon SNS message signature verification
 * (https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html).
 * Without it anyone could POST fake bounces/complaints and suppress arbitrary
 * addresses, or make the server fetch an arbitrary SubscribeURL.
 */
export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Signature: string;
  SignatureVersion: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/** Only https URLs on an SNS endpoint host are trusted (cert download + subscription confirm). */
export function isSnsUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && SNS_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

const certCache = new Map<string, string>();
async function fetchCert(url: string): Promise<string> {
  const hit = certCache.get(url);
  if (hit) return hit;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`cert fetch ${res.status}`);
  const pem = await res.text();
  if (!pem.includes("BEGIN CERTIFICATE")) throw new Error("not a certificate");
  certCache.set(url, pem);
  return pem;
}

function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  let out = "";
  for (const k of keys) {
    const v = (m as unknown as Record<string, string | undefined>)[k];
    if (v === undefined) continue; // Subject is optional
    out += `${k}\n${v}\n`;
  }
  return out;
}

export async function verifySnsMessage(m: SnsMessage): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!m || typeof m !== "object" || !m.Signature || !m.SigningCertURL) return { ok: false, reason: "unsigned" };
  if (!isSnsUrl(m.SigningCertURL)) return { ok: false, reason: "untrusted cert url" };

  const allowedTopics = (process.env.SES_SNS_TOPIC_ARNS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowedTopics.length && !allowedTopics.includes(m.TopicArn)) return { ok: false, reason: "unexpected topic" };

  // Reject replays of old messages
  const age = Date.now() - Date.parse(m.Timestamp);
  if (!(age < 3600_000)) return { ok: false, reason: "stale message" };

  const algo = m.SignatureVersion === "2" ? "RSA-SHA256" : m.SignatureVersion === "1" ? "RSA-SHA1" : null;
  if (!algo) return { ok: false, reason: "unknown signature version" };

  try {
    const cert = await fetchCert(m.SigningCertURL);
    const ok = createVerify(algo).update(stringToSign(m), "utf8").verify(cert, m.Signature, "base64");
    return ok ? { ok: true } : { ok: false, reason: "bad signature" };
  } catch (err) {
    return { ok: false, reason: `verify error: ${String(err)}` };
  }
}
