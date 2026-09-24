/**
 * The HMAC secret for session cookies and tracking/unsubscribe links.
 * Production refuses to run with a missing or weak secret — a guessable
 * secret would let anyone forge an admin session.
 */
export function appSecret(): string {
  const s = process.env.TRACKING_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("TRACKING_SECRET must be set to a random string of at least 32 characters in production");
  }
  return s || "insecure-dev-secret";
}
