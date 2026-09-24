import { db } from "./db";
import type { SessionPayload } from "./session";

/**
 * Server-side session revocation. Session cookies are signed and stateless;
 * this checks them against the user row so that deleting a user, changing
 * their role, resetting their password/2FA or "sign out everywhere" takes
 * effect within SESSION_CHECK_TTL (15 s) instead of at cookie expiry.
 *
 * The cache only ever delays a revocation: a session the cache considers
 * invalid is re-checked against the database before it is rejected, so a
 * fresh sign-in right after a change is never locked out by stale data.
 * (The proxy and route handlers are separate bundles with separate caches,
 * which is why this can't simply be cleared on write.)
 */
type Entry = { at: number; role: string; sv: number } | null;
const cache = new Map<string, Entry>();
const TTL = () => Number(process.env.SESSION_CHECK_TTL_MS) || 15_000;

async function load(uid: string): Promise<Entry> {
  const u = await db.user.findUnique({ where: { id: uid }, select: { role: true, sessionVersion: true } });
  const entry = u ? { at: Date.now(), role: u.role, sv: u.sessionVersion } : null;
  if (cache.size > 10_000) cache.clear();
  cache.set(uid, entry);
  return entry;
}

const matches = (e: Entry, s: SessionPayload) => !!e && e.role === s.role && e.sv === (s.sv ?? 0);

export async function sessionStillValid(s: SessionPayload): Promise<boolean> {
  const cached = cache.get(s.uid);
  if (cached && Date.now() - cached.at < TTL() && matches(cached, s)) return true;
  return matches(await load(s.uid), s); // missing, expired, or says invalid: ask the database
}

export function forgetSessionCache(uid: string): void {
  cache.delete(uid);
}

/** Revoke every session of a user (next request from any of them is signed out). */
export async function revokeSessions(uid: string): Promise<void> {
  await db.user.update({ where: { id: uid }, data: { sessionVersion: { increment: 1 } } });
  forgetSessionCache(uid);
}
