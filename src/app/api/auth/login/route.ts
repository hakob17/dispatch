import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { clientIp, hitRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { createPendingToken, finishLogin, getSecuritySettings } from "@/lib/loginFlow";

/**
 * Password sign-in. Responses:
 *   { ok, role }                              signed in
 *   { mfaRequired: true, pendingToken }       → POST /api/auth/mfa/verify
 *   { mfaSetupRequired: true, pendingToken }  → /api/auth/mfa/setup + /enable (MFA is mandatory)
 */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return NextResponse.json({ error: "email and password required" }, { status: 400 });

  const ip = clientIp(req.headers);
  const userAgent = req.headers.get("user-agent");
  // Brute-force guard: 10 attempts per minute per IP
  const rl = await hitRateLimit(`login:${ip}`, 10);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const user = await db.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await audit({ userEmail: String(email).toLowerCase(), action: "auth.login_failed", status: 401, ip, userAgent });
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const security = await getSecuritySettings();
  if (security.enforceSso && user.role !== "ADMIN") {
    await audit({ userId: user.id, userEmail: user.email, action: "auth.login_blocked", status: 403, ip, userAgent, meta: { reason: "sso enforced" } });
    return NextResponse.json({ error: "Password sign-in is disabled for your account. Use single sign-on.", sso: true }, { status: 403 });
  }

  if (user.mfaEnabled) {
    return NextResponse.json({ mfaRequired: true, pendingToken: createPendingToken(user.id, "mfa") });
  }
  if (security.requireMfa) {
    return NextResponse.json({ mfaSetupRequired: true, pendingToken: createPendingToken(user.id, "mfa-setup") });
  }
  return finishLogin(req, user, "password");
}
