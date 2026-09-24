import { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { db } from "./db";
import { getSession } from "./auth";
import { verifyPendingToken } from "./loginFlow";
import { decryptSecret, hashRecovery, verifyTotp } from "./mfa";

/**
 * The user an MFA call is about: either the signed-in user (managing their own
 * MFA from Settings) or the holder of a pending-login token (mid sign-in).
 */
export async function mfaSubject(
  req: NextRequest,
  pendingToken: string | undefined,
  purposes: ("mfa" | "mfa-setup")[]
): Promise<{ user: User; viaPending: boolean } | null> {
  const pending = verifyPendingToken(pendingToken, purposes);
  if (pending) {
    const user = await db.user.findUnique({ where: { id: pending.uid } });
    return user ? { user, viaPending: true } : null;
  }
  const session = await getSession();
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.uid } });
  return user ? { user, viaPending: false } : null;
}

/** Check a TOTP code (with replay protection) or a one-time recovery code. Consumes what it accepts. */
export async function checkSecondFactor(user: User, code?: string, recoveryCode?: string): Promise<"totp" | "recovery" | null> {
  if (!user.mfaSecret) return null;
  if (code) {
    const step = verifyTotp(decryptSecret(user.mfaSecret), code, user.mfaLastStep);
    if (step === null) return null;
    // Conditional update: two concurrent requests can't both use the same code
    const res = await db.user.updateMany({
      where: { id: user.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      data: { mfaLastStep: step },
    });
    return res.count ? "totp" : null;
  }
  if (recoveryCode) {
    const hashes = (user.mfaRecoveryCodes as string[] | null) ?? [];
    const h = hashRecovery(recoveryCode);
    if (!hashes.includes(h)) return null;
    await db.user.update({ where: { id: user.id }, data: { mfaRecoveryCodes: hashes.filter((x) => x !== h) } });
    return "recovery";
  }
  return null;
}
