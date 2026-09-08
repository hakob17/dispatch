import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/** PATCH { role?, password?, name? } — admin-only (middleware). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const session = await getSession();

  if (body.role === "USER" && session?.uid === id) {
    const admins = await db.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return NextResponse.json({ error: "cannot demote the last admin" }, { status: 400 });
  }
  if (body.password && String(body.password).length < 8) {
    return NextResponse.json({ error: "password must be 8+ characters" }, { status: 400 });
  }

  const user = await db.user.update({
    where: { id },
    data: {
      role: body.role ?? undefined,
      name: body.name ?? undefined,
      passwordHash: body.password ? hashPassword(body.password) : undefined,
    },
    select: { id: true, email: true, name: true, role: true },
  });
  return NextResponse.json(user);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getSession();
  if (session?.uid === id) {
    return NextResponse.json({ error: "cannot delete your own account" }, { status: 400 });
  }
  const target = await db.user.findUnique({ where: { id } });
  if (target?.role === "ADMIN") {
    const admins = await db.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return NextResponse.json({ error: "cannot delete the last admin" }, { status: 400 });
  }
  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
