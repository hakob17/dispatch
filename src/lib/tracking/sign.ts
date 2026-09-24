import { createHmac, timingSafeEqual } from "crypto";
import { appSecret as secret } from "../secret";

export function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url").slice(0, 24);
}

export function verify(payload: string, sig: string): boolean {
  const expected = sign(payload);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** Opaque unsubscribe token: base64url(payload).sig where payload = JSON {c: contactId, m?: messageId} */
export function makeUnsubToken(contactId: string, messageId?: string): string {
  const payload = Buffer.from(JSON.stringify({ c: contactId, m: messageId })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseUnsubToken(token: string): { contactId: string; messageId?: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!verify(payload, sig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.c !== "string") return null;
    return { contactId: parsed.c, messageId: parsed.m };
  } catch {
    return null;
  }
}
