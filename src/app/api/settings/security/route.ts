import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSetting } from "@/lib/settings";
import { getSecuritySettings } from "@/lib/loginFlow";
import { getSsoConfig } from "@/lib/sso";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

// Admin-only (proxy: /api/settings/*).

export async function GET() {
  return NextResponse.json(await getSecuritySettings());
}

const schema = z.object({ requireMfa: z.boolean(), enforceSso: z.boolean() });

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  if (body.data.enforceSso && !(await getSsoConfig())) {
    return NextResponse.json({ error: "Configure single sign-on before enforcing it" }, { status: 400 });
  }
  if (body.data.requireMfa) {
    // Don't let an admin lock themselves out mid-session: they must have MFA first
    const session = await getSession();
    const me = session ? await db.user.findUnique({ where: { id: session.uid } }) : null;
    if (!me?.mfaEnabled) return NextResponse.json({ error: "Turn on two-factor for your own account first" }, { status: 400 });
  }
  await setSetting("security", body.data);
  return NextResponse.json({ ok: true });
}
