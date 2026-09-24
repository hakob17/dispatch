import { XMLParser } from "fast-xml-parser";
import type { ContentFeed, Prisma } from "@prisma/client";
import { raiseAlert, resolveAlert } from "./alerts";
import { db } from "./db";
import { enqueue } from "./queue/enqueue";
import { invalidateCandidatePool } from "./recommend";
import { normalizeLanguage } from "./localize";

/**
 * Content feeds: the worker polls RSS 2.0, Atom and JSON Feed URLs, upserts
 * new articles into the catalog (for recommendations and {{item.*}}), and —
 * when the feed has an auto-send campaign — launches it once per new article.
 *
 * Safety: the first fetch of a feed only imports (never sends), and only
 * articles published in the last FEED_AUTOSEND_MAX_AGE_MIN minutes (default
 * 120) are auto-sent, so re-adding a feed can't blast yesterday's news.
 */
export interface ParsedItem {
  externalId: string;
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  section: string | null;
  tags: string[];
  language: string | null;
  publishedAt: Date;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", isArray: (n) => ["item", "entry", "category", "link", "media:content", "enclosure"].includes(n) });

const text = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return String(v).trim() || null;
  if (typeof v === "object" && "#text" in (v as object)) return text((v as Record<string, unknown>)["#text"]);
  return null;
};
const stripHtml = (s: string | null) => (s ? s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null : null);
const date = (v: unknown): Date => {
  const d = new Date(text(v) ?? "");
  return isNaN(d.getTime()) || d.getTime() > Date.now() + 3600_000 ? new Date() : d;
};

export function parseFeed(body: string, contentType = ""): { items: ParsedItem[]; language: string | null } {
  const trimmed = body.trimStart();
  if (contentType.includes("json") || trimmed.startsWith("{")) {
    const j = JSON.parse(body) as { language?: string; items?: Record<string, unknown>[] };
    const language = normalizeLanguage(j.language);
    return {
      language,
      items: (j.items ?? [])
        .filter((i) => (i.url || i.id) && (i.title || i.content_text))
        .map((i) => ({
          externalId: String(i.id ?? i.url),
          title: String(i.title ?? i.content_text).slice(0, 300),
          url: String(i.url ?? i.external_url ?? i.id),
          summary: stripHtml(String(i.summary ?? i.content_text ?? "")),
          imageUrl: (i.image as string) ?? (i.banner_image as string) ?? null,
          section: null,
          tags: Array.isArray(i.tags) ? (i.tags as string[]) : [],
          language: normalizeLanguage(i.language as string) ?? language,
          publishedAt: date(i.date_published ?? i.date_modified),
        })),
    };
  }

  const doc = xml.parse(body) as Record<string, Record<string, unknown>>;
  if (doc.rss) {
    const channel = doc.rss.channel as Record<string, unknown>;
    const language = normalizeLanguage(text(channel.language));
    const items = (channel.item as Record<string, unknown>[] | undefined) ?? [];
    return {
      language,
      items: items
        .map((i): ParsedItem | null => {
          const link = text((i.link as unknown[] | undefined)?.[0]);
          const guid = text(i.guid) ?? link;
          const title = text(i.title);
          if (!guid || !title || !link) return null;
          const media = (i["media:content"] as Record<string, string>[] | undefined)?.find((m) => m["@url"]);
          const enclosure = (i.enclosure as Record<string, string>[] | undefined)?.find((e) => (e["@type"] ?? "").startsWith("image"));
          const thumb = i["media:thumbnail"] as Record<string, string> | undefined;
          const categories = ((i.category as unknown[]) ?? []).map(text).filter(Boolean) as string[];
          return {
            externalId: guid,
            title: title.slice(0, 300),
            url: link,
            summary: stripHtml(text(i.description)),
            imageUrl: media?.["@url"] ?? enclosure?.["@url"] ?? thumb?.["@url"] ?? null,
            section: categories[0] ?? null,
            tags: categories,
            language,
            publishedAt: date(i.pubDate ?? i["dc:date"]),
          };
        })
        .filter((x): x is ParsedItem => !!x),
    };
  }
  if (doc.feed) {
    const feed = doc.feed as Record<string, unknown>;
    const language = normalizeLanguage((feed["@xml:lang"] as string) ?? null);
    const entries = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
    return {
      language,
      items: entries
        .map((e): ParsedItem | null => {
          const links = (e.link as Record<string, string>[] | undefined) ?? [];
          const link = (links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0])?.["@href"];
          const id = text(e.id) ?? link;
          const title = text(e.title);
          if (!id || !title || !link) return null;
          const categories = ((e.category as Record<string, string>[]) ?? []).map((c) => c["@term"]).filter(Boolean);
          const media = (e["media:content"] as Record<string, string>[] | undefined)?.find((m) => m["@url"]);
          return {
            externalId: id,
            title: title.slice(0, 300),
            url: link,
            summary: stripHtml(text(e.summary) ?? text(e.content)),
            imageUrl: media?.["@url"] ?? links.find((l) => l["@rel"] === "enclosure" && (l["@type"] ?? "").startsWith("image"))?.["@href"] ?? null,
            section: categories[0] ?? null,
            tags: categories,
            language,
            publishedAt: date(e.published ?? e.updated),
          };
        })
        .filter((x): x is ParsedItem => !!x),
    };
  }
  throw new Error("not an RSS, Atom or JSON feed");
}

/** Upsert catalog items; returns the ids of rows that are new. */
export async function upsertItems(items: (Omit<ParsedItem, "tags"> & { tags?: string[]; expiresAt?: Date | null })[]): Promise<{ id: string; externalId: string; publishedAt: Date }[]> {
  const existing = new Set(
    (await db.contentItem.findMany({ where: { externalId: { in: items.map((i) => i.externalId) } }, select: { externalId: true } })).map((i) => i.externalId)
  );
  const created: { id: string; externalId: string; publishedAt: Date }[] = [];
  for (const i of items) {
    const data: Prisma.ContentItemUncheckedCreateInput = {
      externalId: i.externalId,
      title: i.title,
      url: i.url,
      summary: i.summary,
      imageUrl: i.imageUrl,
      section: i.section,
      tags: i.tags ?? [],
      language: i.language,
      publishedAt: i.publishedAt,
      expiresAt: i.expiresAt ?? null,
    };
    const row = await db.contentItem.upsert({
      where: { externalId: i.externalId },
      create: data,
      update: { title: data.title, url: data.url, summary: data.summary, imageUrl: data.imageUrl, section: data.section, tags: data.tags, expiresAt: data.expiresAt },
      select: { id: true, externalId: true, publishedAt: true },
    });
    if (!existing.has(i.externalId)) created.push(row);
  }
  if (items.length) invalidateCandidatePool();
  return created;
}

/** Worker handler for FEED_POLL. */
export async function pollFeed(payload: { feedId: string }): Promise<void> {
  const feed = await db.contentFeed.findUnique({ where: { id: payload.feedId } });
  if (!feed || !feed.isActive) return;
  const firstFetch = !feed.lastFetchedAt;
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Dispatch-Feeds/1.0", Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/xml, */*" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items } = parseFeed(await res.text(), res.headers.get("content-type") ?? "");
    const created = await upsertItems(items.slice(0, 200).map((i) => ({ ...i, section: i.section ?? feed.section })));

    let launched = 0;
    if (feed.autoCampaignId && !firstFetch) {
      const maxAge = (Number(process.env.FEED_AUTOSEND_MAX_AGE_MIN) || 120) * 60_000;
      for (const item of created) {
        if (Date.now() - item.publishedAt.getTime() > maxAge) continue;
        await enqueue("LAUNCH_CAMPAIGN", { campaignId: feed.autoCampaignId, contentItemId: item.id });
        launched++;
      }
    }
    await db.contentFeed.update({
      where: { id: feed.id },
      data: { lastFetchedAt: new Date(), lastError: null, itemsIngested: { increment: created.length } },
    });
    if (feed.lastError) await resolveAlert(`feed:${feed.id}`, `Feed "${feed.name}" is fetching again`);
    if (created.length) console.log(`[feeds] ${feed.name}: ${created.length} new item(s), ${launched} auto-send(s)`);
  } catch (err) {
    await db.contentFeed.update({ where: { id: feed.id }, data: { lastFetchedAt: new Date(), lastError: String(err).slice(0, 300) } });
    // Two failed polls in a row: new articles aren't arriving (and auto-sends aren't firing)
    if (feed.lastError) {
      await raiseAlert({
        key: `feed:${feed.id}`,
        source: "FEED",
        title: `Feed "${feed.name}" can't be fetched`,
        detail: `${feed.url} — ${String(err).slice(0, 300)}. New articles and their auto-sends are paused until it recovers.`,
      });
    }
    throw err instanceof SyntaxError ? err : new Error(String(err)); // queue retries network errors
  }
}

/** Housekeeping: enqueue polls for feeds that are due. */
export async function scheduleFeedPolls(): Promise<number> {
  const feeds: Pick<ContentFeed, "id" | "pollMinutes" | "lastFetchedAt">[] = await db.contentFeed.findMany({
    where: { isActive: true },
    select: { id: true, pollMinutes: true, lastFetchedAt: true },
  });
  const due = feeds.filter((f) => !f.lastFetchedAt || Date.now() - f.lastFetchedAt.getTime() >= f.pollMinutes * 60_000);
  for (const f of due) {
    const pending = await db.job.count({ where: { type: "FEED_POLL", status: { in: ["PENDING", "RUNNING"] }, payload: { path: ["feedId"], equals: f.id } } });
    if (!pending) await enqueue("FEED_POLL", { feedId: f.id });
  }
  return due.length;
}
