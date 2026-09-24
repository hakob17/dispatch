import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseFeed } from "../src/lib/feeds";
import { templateRecNeeds, recVars } from "../src/lib/recommend";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><language>en-gb</language>
<item><title>Markets rally &amp; close higher</title><link>https://news.test/a1</link><guid>a1</guid><pubDate>Thu, 24 Sep 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>Stocks <b>rose</b> today.</p>]]></description><category>markets</category><category>stocks</category>
<media:content url="https://img.test/a1.jpg" medium="image"/></item>
<item><title>No link item</title><guid>x</guid></item></channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="de"><entry><id>urn:b1</id><title>Wahl: erste Ergebnisse</title>
<link rel="alternate" href="https://news.test/b1"/><updated>2026-09-24T09:00:00Z</updated><summary>Kurz</summary><category term="politics"/></entry></feed>`;

test("RSS: fields, HTML stripped, categories → section + tags, media image, invalid items skipped", () => {
  const { items, language } = parseFeed(RSS);
  assert.equal(language, "en-GB");
  assert.equal(items.length, 1);
  const a = items[0];
  assert.deepEqual(
    [a.externalId, a.title, a.url, a.summary, a.imageUrl, a.section, a.tags, a.publishedAt.toISOString()],
    ["a1", "Markets rally & close higher", "https://news.test/a1", "Stocks rose today.", "https://img.test/a1.jpg", "markets", ["markets", "stocks"], "2026-09-24T10:00:00.000Z"]
  );
});

test("Atom and JSON Feed parse too", () => {
  const atom = parseFeed(ATOM).items[0];
  assert.deepEqual([atom.externalId, atom.url, atom.language, atom.section], ["urn:b1", "https://news.test/b1", "de", "politics"]);
  const json = parseFeed(JSON.stringify({ version: "https://jsonfeed.org/version/1.1", items: [{ id: "c1", url: "https://news.test/c1", title: "C", tags: ["tech"], date_published: "2026-09-24T08:00:00Z" }] }), "application/feed+json");
  assert.deepEqual([json.items[0].externalId, json.items[0].tags], ["c1", ["tech"]]);
  assert.throws(() => parseFeed("<html></html>"));
});

test("template recommendation detection and variables", () => {
  assert.deepEqual(templateRecNeeds(["Read {{ recommendation.1.title }}", null]), { recommendation: true, trending: false, item: false });
  assert.deepEqual(templateRecNeeds(["{{item.url}}", "{{trending.2.title}}"]), { recommendation: false, trending: true, item: true });
  const v = recVars("recommendation", [{ title: "T", url: "u", summary: null, imageUrl: null, section: "s" }]);
  assert.equal(v["recommendation.1.title"], "T");
  assert.equal(v["recommendation.1.summary"], "");
});

const enabled = !!process.env.DATABASE_URL;
const tag = `reco-${randomUUID().slice(0, 8)}`;

test("recommender: affinity beats popularity for engaged readers; read and sent articles are excluded", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { recommendForContacts, invalidateCandidatePool } = await import("../src/lib/recommend");
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
  const mk = (id: string, section: string, h: number, tags: string[] = []) =>
    db.contentItem.create({ data: { externalId: `${tag}-${id}`, title: id, url: `https://t/${id}`, section, tags, publishedAt: hoursAgo(h) } });
  const [m1, , m3, s1] = await Promise.all([mk("m1", "markets", 1, ["fed"]), mk("m2", "markets", 3, ["fed"]), mk("m3", "markets", 2), mk("s1", "sport", 1), mk("s2", "sport", 2)]);

  const reader = await db.contact.create({ data: { externalId: `${tag}-reader` } });
  const crowd = await db.contact.create({ data: { externalId: `${tag}-crowd` } });
  // The reader reads markets; the crowd makes sport popular
  await db.contactEvent.createMany({
    data: [
      { contactId: reader.id, name: "article_read", properties: { itemId: m1.externalId } },
      ...Array.from({ length: 20 }, () => ({ contactId: crowd.id, name: "article_read", properties: { itemId: s1.externalId } })),
    ],
  });
  // m3 was already pushed to the reader
  await db.message.create({ data: { contactId: reader.id, channel: "FCM", status: "SENT", contentItemId: m3.id } });
  invalidateCandidatePool();

  const recs = (await recommendForContacts([{ id: reader.id }], { limit: 20 })).get(reader.id)!.filter((r) => r.externalId.startsWith(tag));
  const ids = recs.map((r) => r.title);
  assert.ok(!ids.includes("m1"), "already read");
  assert.ok(!ids.includes("m3"), "already sent");
  assert.equal(ids[0], "m2", `markets + fed affinity should win, got ${ids}`);

  const trending = (await recommendForContacts([{ id: "nobody" }], { strategy: "trending", limit: 20 })).get("nobody")!.filter((r) => r.externalId.startsWith(tag));
  assert.equal(trending[0].title, "s1");
});

after(async () => {
  if (!enabled) return;
  const { db } = await import("../src/lib/db");
  await db.contact.deleteMany({ where: { externalId: { startsWith: tag } } });
  await db.contentItem.deleteMany({ where: { externalId: { startsWith: tag } } });
  await db.$disconnect();
});
