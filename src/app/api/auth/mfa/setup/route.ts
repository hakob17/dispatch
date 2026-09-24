import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { mfaSubject } from "@/lib/mfaUser";
import { encryptSecret, newSecret, otpauthUrl } from "@/lib/mfa";

/**
 * Start enrolment: create a new (not yet active) secret and return it as an
 * otpauth:// URL, a QR code and the raw key for manual entry.
 * Called signed-in (Settings) or with a pendingToken when MFA is mandatory.
 */
export async function POST(req: NextRequest) {
  const { pendingToken } = await req.json().catch(() => ({}));
  const subject = await mfaSubject(req, pendingToken, ["mfa-setup"]);
  if (!subject) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (subject.user.mfaEnabled) return NextResponse.json({ error: "MFA is already enabled" }, { status: 400 });

  const secret = newSecret();
  await db.user.update({ where: { id: subject.user.id }, data: { mfaSecret: encryptSecret(secret), mfaLastStep: null } });
  const url = otpauthUrl(secret, subject.user.email);
  return NextResponse.json({
    secret: secret.match(/.{1,4}/g)!.join(" "),
    otpauthUrl: url,
    qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }),
  });
}
