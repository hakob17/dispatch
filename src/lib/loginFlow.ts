import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { User } from "@prisma/client";
import { db } from "./db";
import { appSecret } from "./secret";
import { createSessionToken, SESSION_COOKIE } from "./session";
import { audit } from "./audit";
import { clientIp } from "./rateLimit";
import { getSetting } from "./settings";

export interface SecuritySettings {
  /** Password sign-ins must pass a TOTP code (users without one enrol at next sign-in). */
  requireMfa: boolean;
  /** Password sign-in is disabled for non-admins; admins keep it (with MFA) as break-glass access. */
  enforceSso: boolean;
}

export async function getSecuritySettings(): Promise<SecuritySettings> {
  const s = (await getSetting<Partial<SecuritySettings>>("security")) ?? {};
  return {
    requireMfa: s.requireMfa ?? process.env.REQUIRE_MFA === "true",
    enforceSso: s.enforceSso ?? process.env.ENFORCE_SSO === "true",
  };
}

type PendingPurpose = "mfa" | "mfa-setup";

/**
 * Short-lived proof that the password step succeeded, carried into the MFA
 * step. Signed with a separate key so it can never be used as a session.
 */
export function createPendingToken(uid: string, purpose: PendingPurpose, ttlSeconds = 600): string {
  const body = Buffer.from(JSON.stringify({ uid, purpose, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", `${appSecret()}:pending-login`).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPendingToken(token: string | undefined | null, purposes: PendingPurpose[]): { uid: string; purpose: PendingPurpose } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", `${appSecret()}:pending-login`).update(body).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof p.uid !== "string" || !purposes.includes(p.purpose) || !(p.exp > Date.now() / 1000)) return null;
    return { uid: p.uid, purpose: p.purpose };
  } catch {
    return null;
  }
}

/** Issue the session cookie, stamp lastLoginAt, write the audit entry. */
export async function finishLogin(
  req: NextRequest,
  user: User,
  method: "password" | "password+mfa" | "recovery-code" | "sso" | "bootstrap",
  res: NextResponse = NextResponse.json({ ok: true, role: user.role })
): Promise<NextResponse> {
  const token = await createSessionToken({ uid: user.id, email: user.email, role: user.role, sv: user.sessionVersion });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Number(process.env.SESSION_DAYS || 7) * 86400,
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({
    userId: user.id,
    userEmail: user.email,
    action: "auth.login",
    status: 200,
    ip: clientIp(req.headers),
    userAgent: req.headers.get("user-agent"),
    meta: { method },
  });
  return res;
}
