import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeSessions } from "@/lib/sessionCheck";
import { audit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/session";

/** "Sign out everywhere": revokes every session of the current user, this one included. */
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  await revokeSessions(session.uid);
  await audit({ userId: session.uid, userEmail: session.email, action: "auth.sessions_revoked" });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
