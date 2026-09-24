import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const user = await db.user.findUnique({ where: { id: session.uid }, select: { mfaEnabled: true, ssoSubject: true, mfaRecoveryCodes: true } });
  return NextResponse.json({
    email: session.email,
    role: session.role,
    mfaEnabled: !!user?.mfaEnabled,
    sso: !!user?.ssoSubject,
    recoveryCodesLeft: Array.isArray(user?.mfaRecoveryCodes) ? (user!.mfaRecoveryCodes as unknown[]).length : 0,
  });
}
