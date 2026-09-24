import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { appSecret } from "./secret";

/**
 * TOTP two-factor (RFC 6238: HMAC-SHA1, 30 s steps, 6 digits) — works with
 * Google Authenticator, Microsoft Authenticator, 1Password, Authy, Okta Verify.
 * Secrets are stored AES-256-GCM encrypted under MFA_ENCRYPTION_KEY (or a key
 * derived from TRACKING_SECRET — rotating that secret then requires users to
 * re-enrol, so set MFA_ENCRYPTION_KEY explicitly in production).
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = "Dispatch";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

/**
 * Check a code against the current step ±1 (clock drift). Returns the matched
 * step, or null. Callers must reject steps ≤ the last accepted one (replay).
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    const expected = totpAt(secretB32, s);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return s;
  }
  return null;
}

export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl(secretB32: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

function key(): Buffer {
  return createHash("sha256").update(process.env.MFA_ENCRYPTION_KEY || `${appSecret()}:mfa`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1") throw new Error("unknown MFA secret format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

/** Ten one-time recovery codes like "7f3k-9q2m"; only their hashes are stored. */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const codes = Array.from({ length: 10 }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}

export function hashRecovery(code: string): string {
  return createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}
