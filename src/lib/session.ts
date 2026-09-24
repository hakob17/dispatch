/**
 * Signed session tokens. Edge-safe: uses only Web Crypto (crypto.subtle),
 * so it runs in Next.js middleware as well as Node route handlers.
 */
import { appSecret as secret } from "./secret";

export interface SessionPayload {
  uid: string;
  email: string;
  role: "ADMIN" | "USER";
  /** user's sessionVersion when issued; a bump revokes the session */
  sv?: number;
  exp: number; // unix seconds
}

export const SESSION_COOKIE = "dispatch_session";

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(base64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createSessionToken(
  payload: Omit<SessionPayload, "exp">,
  days = 7
): Promise<string> {
  const full: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + days * 86400 };
  const body = b64urlEncode(encoder.encode(JSON.stringify(full)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body));
  return `${body}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      b64urlDecode(sig) as BufferSource,
      encoder.encode(body)
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    if (payload.role !== "ADMIN" && payload.role !== "USER") return null;
    return payload;
  } catch {
    return null;
  }
}
