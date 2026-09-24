import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { checkSecondFactor } from "@/lib/mfaUser";
import { getSecuritySettings } from "@/lib/loginFlow";
import { audit } from "@/lib/audit";

/** Turn off your own MFA (needs a current code). Blocked while MFA is mandatory. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if ((await getSecuritySettings()).requireMfa) {
    return NextResponse.json({ error: "Two-factor sign-in is required by your administrator" }, { status: 403 });
  }
  const { code } = await req.json().catch(() => ({}));
  const user = await db.user.findUnique({ where: { id: session.uid } });
  if (!user?.mfaEnabled) return NextResponse.json({ error: "MFA is not enabled" }, { status: 400 });
  if (!(await checkSecondFactor(user, String(code ?? "")))) {
    return NextResponse.json({ error: "That code didn't match" }, { status: 400 });
  }
  await db.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [], mfaLastStep: null } });
  await audit({ userId: user.id, userEmail: user.email, action: "auth.mfa_disabled" });
  return NextResponse.json({ ok: true });
}
