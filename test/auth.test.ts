import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  hashRecovery,
  newRecoveryCodes,
  totpAt,
  verifyTotp,
} from "../src/lib/mfa";
import { createPendingToken, verifyPendingToken } from "../src/lib/loginFlow";
import { newSsoState, readSsoState } from "../src/lib/sso";
import { verifySessionToken } from "../src/lib/session";

// RFC 6238 Appendix B, SHA-1 secret "12345678901234567890" (last 6 of the 8-digit vectors)
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

test("TOTP matches RFC 6238 test vectors", () => {
  assert.equal(RFC_SECRET, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(totpAt(RFC_SECRET, Math.floor(59 / 30)), "287082");
  assert.equal(totpAt(RFC_SECRET, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totpAt(RFC_SECRET, Math.floor(1234567890 / 30)), "005924");
  assert.equal(totpAt(RFC_SECRET, Math.floor(2000000000 / 30)), "279037");
});

test("TOTP accepts ±1 step of drift and rejects replays", () => {
  const now = 1111111109 * 1000;
  const step = Math.floor(1111111109 / 30);
  assert.equal(verifyTotp(RFC_SECRET, "081804", null, now), step);
  assert.equal(verifyTotp(RFC_SECRET, "081 804", null, now), step); // spaces ok
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), null, now), step - 1);
  assert.equal(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), null, now), null);
  assert.equal(verifyTotp(RFC_SECRET, "081804", step, now), null); // already used
  assert.equal(verifyTotp(RFC_SECRET, "12345", null, now), null);
});

test("base32 round-trips", () => {
  const b = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
  assert.deepEqual(base32Decode(base32Encode(b)), b);
});

test("MFA secrets are encrypted at rest and tamper-evident", () => {
  const enc = encryptSecret("JBSWY3DPEHPK3PXP");
  assert.ok(!enc.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(decryptSecret(enc), "JBSWY3DPEHPK3PXP");
  const parts = enc.split(".");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
  assert.throws(() => decryptSecret(parts.join(".")));
});

test("recovery codes: ten unique codes, hashes are case/space-insensitive", () => {
  const { codes, hashes } = newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.equal(hashRecovery(` ${codes[0].toUpperCase()} `), hashes[0]);
});

test("pending-login tokens: purpose-bound and never valid as a session", async () => {
  const t = createPendingToken("user-1", "mfa");
  assert.deepEqual(verifyPendingToken(t, ["mfa"]), { uid: "user-1", purpose: "mfa" });
  assert.equal(verifyPendingToken(t, ["mfa-setup"]), null);
  assert.equal(verifyPendingToken(t.replace(/.$/, (c) => (c === "A" ? "B" : "A")), ["mfa"]), null);
  assert.equal(await verifySessionToken(t), null);
  assert.equal(verifyPendingToken(createPendingToken("u", "mfa", -1), ["mfa"]), null); // expired
});

test("SSO state cookie round-trips and rejects tampering", () => {
  const { cookie, state, challenge } = newSsoState();
  assert.deepEqual(readSsoState(cookie), state);
  assert.equal(challenge.length, 43); // base64url SHA-256
  const [body, sig] = cookie.split(".");
  const forged = Buffer.from(JSON.stringify({ ...state, state: "attacker" })).toString("base64url");
  assert.equal(readSsoState(`${forged}.${sig}`), null);
  assert.equal(readSsoState(`${body}.x${sig.slice(1)}`), null);
});
