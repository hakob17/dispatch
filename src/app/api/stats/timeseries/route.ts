import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db, utcTs } from "@/lib/db";

type DayRow = { day: Date; count: bigint };

async function dailyCounts(table: string, column: string, since: Date): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<DayRow[]>(
    Prisma.sql`
      SELECT date_trunc('day', ${Prisma.raw(`"${column}"`)}) AS day, COUNT(*) AS count
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${Prisma.raw(`"${column}"`)} >= ${utcTs(since)}
      GROUP BY 1 ORDER BY 1`
  );
  return new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
}

/** Daily sent/delivered/opened/clicked/events counts for the last N days. */
export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get("days")) || 30));
  // UTC midnights — date_trunc buckets timestamps in UTC, so the key space must match
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(todayUtc - (days - 1) * 24 * 3600_000);

  const [sent, delivered, opened, clicked, events] = await Promise.all([
    dailyCounts("Message", "sentAt", since),
    dailyCounts("Message", "deliveredAt", since),
    dailyCounts("Message", "openedAt", since),
    dailyCounts("Message", "clickedAt", since),
    dailyCounts("ContactEvent", "createdAt", since),
  ]);

  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 3600_000);
    const key = d.toISOString().slice(0, 10);
    out.push({
      date: key,
      sent: sent.get(key) ?? 0,
      delivered: delivered.get(key) ?? 0,
      opened: opened.get(key) ?? 0,
      clicked: clicked.get(key) ?? 0,
      events: events.get(key) ?? 0,
    });
  }
  return NextResponse.json({ days: out });
}
