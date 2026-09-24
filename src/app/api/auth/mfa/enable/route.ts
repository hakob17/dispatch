import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { mfaSubject, checkSecondFactor } from "@/lib/mfaUser";
import { newRecoveryCodes } from "@/lib/mfa";
import { finishLogin } from "@/lib/loginFlow";
import { audit } from "@/lib/audit";

/**
 * Confirm enrolment with a first code. Returns ten one-time recovery codes
 * (shown once). When enrolling mid sign-in, this also completes the sign-in.
 */
export async function POST(req: NextRequest) {
  const { pendingToken, code } = await req.json().catch(() => ({}));
  const subject = await mfaSubject(req, pendingToken, ["mfa-setup"]);
  if (!subject) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { user } = subject;
  if (user.mfaEnabled) return NextResponse.json({ error: "MFA is already enabled" }, { status: 400 });
  if (!user.mfaSecret) return NextResponse.json({ error: "Start setup first" }, { status: 400 });

  if ((await checkSecondFactor(user, String(code ?? ""))) !== "totp") {
    return NextResponse.json({ error: "That code didn't match. Wait for the next code and try again." }, { status: 400 });
  }
  const { codes, hashes } = newRecoveryCodes();
  const updated = await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaRecoveryCodes: hashes } });
  await audit({ userId: user.id, userEmail: user.email, action: "auth.mfa_enabled" });

  const res = NextResponse.json({ ok: true, recoveryCodes: codes });
  return subject.viaPending ? finishLogin(req, updated, "password+mfa", res) : res;
}
