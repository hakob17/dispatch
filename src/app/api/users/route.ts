import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

// Admin-only (enforced by middleware).

export async function GET() {
  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true, lastLoginAt: true, mfaEnabled: true, ssoSubject: true },
  });
  return NextResponse.json(users);
}

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
});

export async function POST(req: NextRequest) {
  const body = createSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  try {
    const user = await db.user.create({
      data: {
        email: body.data.email.toLowerCase(),
        name: body.data.name || null,
        role: body.data.role,
        passwordHash: hashPassword(body.data.password),
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return NextResponse.json(user, { status: 201 });
  } catch {
    return NextResponse.json({ error: "email already exists" }, { status: 409 });
  }
}
