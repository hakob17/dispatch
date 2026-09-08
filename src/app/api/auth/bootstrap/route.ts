import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { anyUsersExist, hashPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

/** First-run setup: create the initial admin account. Only works while no users exist. */
export async function GET() {
  return NextResponse.json({ needed: !(await anyUsersExist()) });
}

export async function POST(req: NextRequest) {
  if (await anyUsersExist()) {
    return NextResponse.json({ error: "already set up" }, { status: 400 });
  }
  const { email, password, name } = await req.json();
  if (!email || !password || String(password).length < 8) {
    return NextResponse.json({ error: "email and a password of 8+ characters required" }, { status: 400 });
  }
  const user = await db.user.create({
    data: {
      email: String(email).toLowerCase(),
      name: name || null,
      passwordHash: hashPassword(password),
      role: "ADMIN",
    },
  });
  const token = await createSessionToken({ uid: user.id, email: user.email, role: user.role });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 86400,
  });
  return res;
}
