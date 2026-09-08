import { NextRequest, NextResponse } from "next/server";
import { getFcmServiceAccount, setSetting, deleteSetting } from "@/lib/settings";

export async function GET() {
  const sa = await getFcmServiceAccount();
  return NextResponse.json({
    configured: !!sa,
    projectId: (sa?.project_id as string) ?? null,
  });
}

/** Store a Firebase service-account JSON. Body: the raw service-account object. */
export async function POST(req: NextRequest) {
  const sa = await req.json();
  if (!sa?.project_id || !sa?.private_key || !sa?.client_email) {
    return NextResponse.json(
      { error: "not a valid service-account JSON (need project_id, private_key, client_email)" },
      { status: 400 }
    );
  }
  await setSetting("fcmServiceAccount", sa);
  return NextResponse.json({ ok: true, projectId: sa.project_id });
}

export async function DELETE() {
  await deleteSetting("fcmServiceAccount");
  return NextResponse.json({ ok: true });
}
