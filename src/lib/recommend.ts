import { Prisma, type ContentItem } from "@prisma/client";
import { db, utcTs } from "./db";

/**
 * Article recommendations for news: a transparent hybrid score, cheap enough
 * to personalise every message of a broadcast.
 *
 *   for_you  = 0.5·affinity + 0.3·popularity + 0.2·freshness
 *   trending = popularity × freshness
 *   latest   = freshness (optionally within a section)
 *
 *  - affinity: the reader's section/tag mix from their reads in the last 30
 *    days, recency-weighted (a read today counts more than one last month)
 *  - popularity: reads across all readers in the last 24 h (log-scaled)
 *  - freshness: exponential decay, half-life RECO_HALF_LIFE_HOURS (default 12)
 *
 * Articles the reader already read — or was already sent — are never
 * recommended. A "read" is any ContactEvent named in RECO_READ_EVENTS whose
 * properties carry the article id (itemId | contentId | articleId | externalId).
 */
export type Strategy = "for_you" | "trending" | "latest";

export interface RecItem {
  id: string;
  externalId: string;
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  section: string | null;
  publishedAt: Date;
  score: number;
}

const HALF_LIFE_H = () => Number(process.env.RECO_HALF_LIFE_HOURS) || 12;
const WINDOW_H = () => Number(process.env.RECO_WINDOW_HOURS) || 72;
export const readEvents = () =>
  (process.env.RECO_READ_EVENTS || "article_read,Article Read,content_viewed,Content Viewed").split(",").map((s) => s.trim());

/** SQL expression pulling the article id out of an event's properties. */
const ITEM_ID_SQL = Prisma.sql`COALESCE(properties->>'itemId', properties->>'contentId', properties->>'articleId', properties->>'externalId')`;

interface Candidate extends ContentItem {
  popularity: number;
}

let poolCache: { at: number; items: Candidate[]; maxPop: number } | null = null;

/** Recent, unexpired articles with their 24 h read counts (cached 60 s per process). */
export async function candidatePool(): Promise<{ items: Candidate[]; maxPop: number }> {
  if (poolCache && Date.now() - poolCache.at < 60_000) return poolCache;
  const since = new Date(Date.now() - WINDOW_H() * 3600_000);
  const now = new Date();
  const items = await db.contentItem.findMany({
    where: { publishedAt: { gte: since, lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { publishedAt: "desc" },
    take: 2000,
  });
  const reads = items.length
    ? await db.$queryRaw<{ item: string; n: bigint }[]>`
        SELECT ${ITEM_ID_SQL} AS item, count(*) AS n FROM "ContactEvent"
        WHERE name IN (${Prisma.join(readEvents())}) AND "createdAt" > ${utcTs(new Date(Date.now() - 24 * 3600_000))}
        GROUP BY 1`
    : [];
  const pop = new Map(reads.map((r) => [r.item, Number(r.n)]));
  const withPop = items.map((i) => ({ ...i, popularity: pop.get(i.externalId) ?? 0 }));
  poolCache = { at: Date.now(), items: withPop, maxPop: Math.max(1, ...withPop.map((i) => i.popularity)) };
  return poolCache;
}

export function invalidateCandidatePool(): void {
  poolCache = null;
}

interface ReaderProfile {
  sections: Map<string, number>;
  tags: Map<string, number>;
  seen: Set<string>; // ContentItem ids read or already sent
}

/** One query for a whole batch of contacts: recent reads (→ affinity) and recently sent articles (→ exclusions). */
async function readerProfiles(contactIds: string[]): Promise<Map<string, ReaderProfile>> {
  const profiles = new Map<string, ReaderProfile>(contactIds.map((id) => [id, { sections: new Map(), tags: new Map(), seen: new Set() }]));
  if (!contactIds.length) return profiles;
  const since = new Date(Date.now() - 30 * 86400_000);
  const reads = await db.$queryRaw<{ contactId: string; itemId: string; section: string | null; tags: unknown; ageDays: number }[]>`
    SELECT e."contactId", ci.id AS "itemId", ci.section, ci.tags,
           extract(epoch FROM (now() AT TIME ZONE 'UTC') - e."createdAt") / 86400 AS "ageDays"
    FROM (
      SELECT "contactId", ${ITEM_ID_SQL} AS ext, "createdAt",
             row_number() OVER (PARTITION BY "contactId" ORDER BY "createdAt" DESC) AS rn
      FROM "ContactEvent"
      WHERE "contactId" IN (${Prisma.join(contactIds)}) AND name IN (${Prisma.join(readEvents())}) AND "createdAt" > ${utcTs(since)}
    ) e
    JOIN "ContentItem" ci ON ci."externalId" = e.ext
    WHERE e.rn <= 50`;
  for (const r of reads) {
    const p = profiles.get(r.contactId)!;
    const w = Math.pow(0.5, Number(r.ageDays) / 7); // a week-old read counts half
    p.seen.add(r.itemId);
    if (r.section) p.sections.set(r.section, (p.sections.get(r.section) ?? 0) + w);
    for (const t of Array.isArray(r.tags) ? (r.tags as string[]) : []) p.tags.set(t, (p.tags.get(t) ?? 0) + w);
  }
  const sent = await db.message.findMany({
    where: { contactId: { in: contactIds }, contentItemId: { not: null }, createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } },
    select: { contactId: true, contentItemId: true },
  });
  for (const m of sent) profiles.get(m.contactId)?.seen.add(m.contentItemId!);
  return profiles;
}

function freshness(publishedAt: Date): number {
  const ageH = Math.max(0, (Date.now() - publishedAt.getTime()) / 3600_000);
  return Math.pow(0.5, ageH / HALF_LIFE_H());
}

function languageOk(item: ContentItem, lang: string | null | undefined): boolean {
  if (!item.language || !lang) return true;
  return item.language.split("-")[0].toLowerCase() === lang.split("-")[0].toLowerCase();
}

export async function recommendForContacts(
  contacts: { id: string; language?: string | null }[],
  opts: { strategy?: Strategy; limit?: number; section?: string } = {}
): Promise<Map<string, RecItem[]>> {
  const strategy = opts.strategy ?? "for_you";
  const limit = Math.min(20, opts.limit ?? 5);
  const { items, maxPop } = await candidatePool();
  const profiles = await readerProfiles(contacts.map((c) => c.id)); // exclusions apply to every strategy
  const out = new Map<string, RecItem[]>();

  for (const c of contacts) {
    const p = profiles.get(c.id) ?? { sections: new Map(), tags: new Map(), seen: new Set<string>() };
    const secTotal = [...p.sections.values()].reduce((a, b) => a + b, 0);
    const tagMax = Math.max(0, ...p.tags.values());
    const scored: RecItem[] = [];
    for (const i of items) {
      if (p.seen.has(i.id) || !languageOk(i, c.language)) continue;
      if (opts.section && i.section !== opts.section) continue;
      const fresh = freshness(i.publishedAt);
      const popularity = Math.log1p(i.popularity) / Math.log1p(maxPop);
      let score: number;
      if (strategy === "latest") score = fresh;
      else if (strategy === "trending") score = (0.1 + popularity) * fresh;
      else {
        const sec = i.section && secTotal ? (p.sections.get(i.section) ?? 0) / secTotal : 0;
        const tags = Array.isArray(i.tags) ? (i.tags as string[]) : [];
        const tag = tagMax ? Math.min(1, tags.reduce((s, t) => s + (p.tags.get(t) ?? 0), 0) / tagMax) : 0;
        const affinity = secTotal ? 0.6 * sec + 0.4 * tag : 0; // cold start: popularity + freshness only
        score = 0.5 * affinity + 0.3 * popularity + 0.2 * fresh;
      }
      scored.push({
        id: i.id,
        externalId: i.externalId,
        title: i.title,
        url: i.url,
        summary: i.summary,
        imageUrl: i.imageUrl,
        section: i.section,
        publishedAt: i.publishedAt,
        score: Math.round(score * 1000) / 1000,
      });
    }
    scored.sort((a, b) => b.score - a.score || b.publishedAt.getTime() - a.publishedAt.getTime());
    out.set(c.id, scored.slice(0, limit));
  }
  return out;
}

/** Template variables: {{recommendation.1.title}} … and {{trending.1.url}} … (1-based). */
export function recVars(
  prefix: "recommendation" | "trending" | "item",
  items: (Pick<RecItem, "title" | "url" | "summary" | "imageUrl" | "section"> & { externalId?: string })[]
): Record<string, string> {
  const vars: Record<string, string> = {};
  items.forEach((it, idx) => {
    const base = prefix === "item" ? "item" : `${prefix}.${idx + 1}`;
    vars[`${base}.id`] = it.externalId ?? "";
    vars[`${base}.title`] = it.title;
    vars[`${base}.url`] = it.url;
    vars[`${base}.summary`] = it.summary ?? "";
    vars[`${base}.imageUrl`] = it.imageUrl ?? "";
    vars[`${base}.section`] = it.section ?? "";
  });
  return vars;
}

/** Which recommendation lists a template's text refers to. */
export function templateRecNeeds(texts: (string | null | undefined)[]): { recommendation: boolean; trending: boolean; item: boolean } {
  const all = texts.filter(Boolean).join("\n");
  return {
    recommendation: /\{\{\s*recommendation\.\d+\./.test(all),
    trending: /\{\{\s*trending\.\d+\./.test(all),
    item: /\{\{\s*item\./.test(all),
  };
}
