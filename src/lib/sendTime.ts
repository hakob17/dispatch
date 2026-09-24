import { Prisma } from "@prisma/client";
import { db, utcTs } from "./db";

/**
 * Send-time optimisation: each reader's best hour of the day (UTC) is the hour they most often
 * engage — push/email opens and clicks (weight 3) and app events (weight 1) over the last 90
 * days. Readers without history get the audience-wide best hour; with no data at all, the
 * campaign sends straight away.
 */
const LOOKBACK_DAYS = 90;

/** contactId → best UTC hour (0–23), for the contacts that have engagement history. */
export async function bestHours(contactIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!contactIds.length) return out;
  const since = utcTs(new Date(Date.now() - LOOKBACK_DAYS * 86400_000));
  for (let i = 0; i < contactIds.length; i += 5000) {
    const ids = contactIds.slice(i, i + 5000);
    const rows = await db.$queryRaw<{ contactId: string; hour: number }[]>`
      SELECT DISTINCT ON ("contactId") "contactId", hour::int AS hour FROM (
        SELECT "contactId", extract(hour FROM "openedAt") AS hour, 3 AS w
          FROM "Message" WHERE "contactId" = ANY(${ids}) AND "openedAt" >= ${since}
        UNION ALL
        SELECT "contactId", extract(hour FROM "clickedAt"), 3
          FROM "Message" WHERE "contactId" = ANY(${ids}) AND "clickedAt" >= ${since}
        UNION ALL
        SELECT "contactId", extract(hour FROM "createdAt"), 1
          FROM "ContactEvent" WHERE "contactId" = ANY(${ids}) AND "createdAt" >= ${since}
      ) e
      GROUP BY "contactId", hour
      ORDER BY "contactId", sum(w) DESC, hour`;
    for (const r of rows) out.set(r.contactId, Number(r.hour));
  }
  return out;
}

let population: { hour: number | null; at: number } | null = null;

/** The hour most readers engage (last 30 days of opens), cached for 6 h. */
export async function populationBestHour(): Promise<number | null> {
  if (population && Date.now() - population.at < 6 * 3600_000) return population.hour;
  const since = utcTs(new Date(Date.now() - 30 * 86400_000));
  const [row] = await db.$queryRaw<{ hour: number | null }[]>(Prisma.sql`
    SELECT extract(hour FROM "openedAt")::int AS hour FROM "Message"
    WHERE "openedAt" >= ${since} GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`);
  population = { hour: row?.hour ?? null, at: Date.now() };
  return population.hour;
}

/** Next time (within 24 h) the UTC clock reads `hour`:00 — now, if we're already in that hour. */
export function nextAtHour(hour: number, from = new Date()): Date {
  if (from.getUTCHours() === hour) return from;
  const at = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, 0, 0));
  if (at <= from) at.setUTCDate(at.getUTCDate() + 1);
  return at;
}

/**
 * When to send each contact's message: their best hour, else the population's, else now.
 * Returns contactId → send time.
 */
export async function sendTimes(contactIds: string[], from = new Date()): Promise<Map<string, Date>> {
  const [hours, fallback] = await Promise.all([bestHours(contactIds), populationBestHour()]);
  const out = new Map<string, Date>();
  for (const id of contactIds) {
    const h = hours.get(id) ?? fallback;
    out.set(id, h === null || h === undefined ? from : nextAtHour(h, from));
  }
  return out;
}
