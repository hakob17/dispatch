import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Load balancer health check (ALB target group). Checks the database too. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "database unreachable" }, { status: 503 });
  }
}
