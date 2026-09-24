import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Open integration alerts — the console banner polls this (any signed-in user). */
export async function GET() {
  const open = await db.systemAlert.findMany({
    where: { resolvedAt: null },
    orderBy: [{ severity: "asc" }, { lastAt: "desc" }], // CRITICAL sorts before WARNING
    take: 20,
  });
  return NextResponse.json({ open });
}
