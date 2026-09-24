import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { finishLogin, verifyPendingToken } from "@/lib/loginFlow";
import { checkSecondFactor } from "@/lib/mfaUser";
import { audit } from "@/lib/audit";
import { clientIp, hitRateLimit, rateLimitedResponse } from "@/lib/rateLimit";

const schema = z.object({
  pendingToken: z.string(),
  code: z.string().optional(),
  recoveryCode: z.string().optional(),
});

/** Second step of a password sign-in for users with MFA enabled. */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "pendingToken and code required" }, { status: 400 });
  const pending = verifyPendingToken(body.data.pendingToken, ["mfa"]);
  if (!pending) return NextResponse.json({ error: "Sign-in expired. Enter your password again." }, { status: 401 });

  // 5 attempts per minute per user: a 6-digit code can't be brute-forced
  const rl = await hitRateLimit(`mfa:${pending.uid}`, 5);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const user = await db.user.findUnique({ where: { id: pending.uid } });
  if (!user?.mfaEnabled) return NextResponse.json({ error: "MFA is not enabled for this account" }, { status: 400 });

  const method = await checkSecondFactor(user, body.data.code, body.data.recoveryCode);
  if (!method) {
    await audit({ userId: user.id, userEmail: user.email, action: "auth.mfa_failed", status: 401, ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ error: "That code didn't match. Check your authenticator app and try again." }, { status: 401 });
  }
  return finishLogin(req, user, method === "totp" ? "password+mfa" : "recovery-code");
}
