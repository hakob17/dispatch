/**
 * Fill an empty workspace with a realistic news-publisher demo: readers with devices and
 * reading history, newsletters and topics, articles, segments, templates, campaigns with
 * delivery stats, and journeys with readers at every step.
 *
 *   npx tsx scripts/seed-demo.ts --yes
 *
 * Refuses to run if the workspace already has contacts. Uses DATABASE_URL.
 * The readers and devices are fictional (example.com addresses, fake push tokens): don't
 * launch new campaigns at them on a workspace with real provider credentials.
 */
import "dotenv/config";
import type { Channel, MessageStatus, Prisma } from "@prisma/client";
import { db } from "../src/lib/db";

// ------------------------------------------------------------------ helpers

let seed = 20261120;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const DAY = 86_400_000;
const NOW = Date.now();
const daysAgo = (d: number, jitterHours = 0) => new Date(NOW - d * DAY + Math.floor(rand() * jitterHours * 3_600_000));
const minutesAfter = (t: Date, a: number, b: number) => new Date(t.getTime() + between(a, b) * 60_000);
const token = (n = 40) => Array.from({ length: n }, () => "abcdef0123456789"[Math.floor(rand() * 16)]).join("");
const chunk = <T>(xs: T[], n = 2000): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
async function createMany<T>(fn: (rows: T[]) => Promise<unknown>, rows: T[]) {
  for (const part of chunk(rows)) await fn(part);
}
let idn = 0;
const id = (p: string) => `demo_${p}_${(++idn).toString(36)}_${token(6)}`;

// ------------------------------------------------------------------ data

const FIRST = ["Sam", "Alex", "Maya", "Leo", "Nora", "Omar", "Ines", "Jonas", "Priya", "Lucas", "Hana", "Mateo", "Elena", "Tom", "Aisha", "Felix", "Sofia", "Daniel", "Yuki", "Chloe", "Ravi", "Emma", "Karl", "Lina", "Diego", "Zara", "Ben", "Mila", "Noah", "Clara"];
const LAST = ["Fischer", "Okafor", "Silva", "Nguyen", "Martin", "Kowalski", "Haddad", "Rossi", "Khan", "Dubois", "Novak", "Ivanova", "Garcia", "Berg", "Moreau", "Schmidt", "Tanaka", "Murphy", "Costa", "Patel"];
const COUNTRIES = [["GB", "en", 30], ["US", "en", 28], ["DE", "de", 12], ["FR", "fr", 10], ["ES", "es", 8], ["IN", "en", 7], ["BR", "pt-BR", 5]] as const;
const SECTIONS = ["world", "politics", "markets", "technology", "sport", "climate"] as const;

const ARTICLES = [
  ["a-election", "Polls open in a knife-edge national election", "politics", "https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=800"],
  ["a-result", "Final seat called as coalition talks begin", "politics", "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=800"],
  ["a-rates", "Central bank holds rates, signals cuts next year", "markets", "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800"],
  ["a-oil", "Oil climbs as supply talks stall", "markets", "https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=800"],
  ["a-chips", "Chipmakers rally on record AI orders", "technology", "https://images.unsplash.com/photo-1518770660439-4636190af475?w=800"],
  ["a-ai-law", "Parliament passes landmark AI safety law", "technology", "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=800"],
  ["a-final", "Late winner settles a dramatic cup final", "sport", "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800"],
  ["a-marathon", "Marathon world record falls in Berlin", "sport", "https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?w=800"],
  ["a-summit", "Leaders agree climate finance deal at summit", "climate", "https://images.unsplash.com/photo-1569163139394-de4e4f43e4e5?w=800"],
  ["a-floods", "Record rainfall forces evacuations along the river delta", "climate", "https://images.unsplash.com/photo-1547683905-f686c993aae5?w=800"],
  ["a-ceasefire", "Ceasefire holds for a third day as aid convoys move in", "world", "https://images.unsplash.com/photo-1526470608268-f674ce90ebd4?w=800"],
  ["a-trade", "Trade ministers strike tariff truce", "world", "https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?w=800"],
] as const;

type Reader = {
  id: string; language: string; country: string; plan: string; interests: string[];
  platforms: ("ios" | "android" | "web")[]; email: string | null; engagement: number; createdAt: Date;
};

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes. This adds a demo workspace's worth of fictional data.");
    process.exitCode = 1;
    return;
  }
  if ((await db.contact.count()) > 0) {
    console.error("The workspace already has contacts. Run scripts/reset-data.ts --yes first.");
    process.exitCode = 1;
    return;
  }

  // -------------------------------------------------------------- readers + devices
  const N = 1200;
  const readers: Reader[] = [];
  const contactRows: Prisma.ContactCreateManyInput[] = [];
  const subRows: Prisma.PushSubscriptionCreateManyInput[] = [];
  for (let i = 0; i < N; i++) {
    const roll = rand() * 100;
    let acc = 0;
    const [country, language] = COUNTRIES.find(([, , w]) => (acc += w) >= roll) ?? COUNTRIES[0];
    const first = pick(FIRST), last = pick(LAST);
    const plan = chance(0.22) ? "subscriber" : chance(0.15) ? "trial" : "free";
    const interests = SECTIONS.filter(() => chance(0.35));
    if (!interests.length) interests.push(pick(SECTIONS));
    const platforms: Reader["platforms"] = [];
    if (chance(0.48)) platforms.push("ios");
    else if (chance(0.62)) platforms.push("android");
    if (chance(0.28)) platforms.push("web");
    const email = chance(0.7) ? `${first}.${last}.${i}@example.com`.toLowerCase() : null;
    const engagement = plan === "subscriber" ? 0.35 + rand() * 0.5 : rand() * 0.6;
    const createdAt = daysAgo(between(2, 420), 24);
    const r: Reader = { id: id("c"), language, country, plan, interests, platforms, email, engagement, createdAt };
    readers.push(r);
    contactRows.push({
      id: r.id, externalId: `reader-${10000 + i}`, email, firstName: first, lastName: last, language,
      phone: chance(0.25) ? `+44 7700 ${between(100000, 999999)}` : null,
      attributes: { country, plan, interests: interests.join(","), platform: platforms[0] ?? "none", articlesRead30d: Math.round(engagement * 60) },
      createdAt,
    });
    for (const p of platforms) {
      subRows.push({
        id: id("s"), contactId: r.id, platform: p,
        channel: p === "ios" ? "APNS" : p === "android" ? "FCM" : "WEB_PUSH",
        endpoint: p === "web" ? `https://fcm.googleapis.com/fcm/send/demo-${token(32)}` : `demo-${p}-${token(48)}`,
        keys: p === "web" ? { p256dh: `demo-${token(43)}`, auth: `demo-${token(16)}` } : undefined,
        deviceId: `demo-${p}-${token(8)}`, appVersion: p === "web" ? "web" : pick(["5.2.0", "5.3.1", "5.4.0"]),
        createdAt: minutesAfter(createdAt, 1, 600), lastUsedAt: daysAgo(between(0, 20), 24),
      });
    }
  }
  await createMany((d) => db.contact.createMany({ data: d }), contactRows);
  await createMany((d) => db.pushSubscription.createMany({ data: d }), subRows);
  const subsOf = new Map<string, Prisma.PushSubscriptionCreateManyInput[]>();
  for (const s of subRows) subsOf.set(s.contactId, [...(subsOf.get(s.contactId) ?? []), s]);

  // -------------------------------------------------------------- reading history
  const eventRows: Prisma.ContactEventCreateManyInput[] = [];
  for (const r of readers) {
    const reads = Math.round(r.engagement * between(5, 45));
    for (let k = 0; k < reads; k++) {
      const a = chance(0.7) ? ARTICLES.find((x) => r.interests.includes(x[2])) ?? pick(ARTICLES) : pick(ARTICLES);
      eventRows.push({ id: id("e"), contactId: r.id, name: "article_read", properties: { itemId: a[0], section: a[2] }, createdAt: daysAgo(between(0, 29), 24) });
    }
    if (r.platforms.length) eventRows.push({ id: id("e"), contactId: r.id, name: "app_open", properties: {}, createdAt: daysAgo(between(0, 6), 24) });
    if (r.createdAt.getTime() > NOW - 14 * DAY) eventRows.push({ id: id("e"), contactId: r.id, name: "signed_up", properties: { source: pick(["app", "web", "newsletter"]) }, createdAt: r.createdAt });
    if (r.interests.includes("politics") && chance(0.3)) eventRows.push({ id: id("e"), contactId: r.id, name: "election_followed", properties: {}, createdAt: daysAgo(between(0, 3), 24) });
    if (r.plan === "trial" && chance(0.3)) eventRows.push({ id: id("e"), contactId: r.id, name: "subscribed", properties: { plan: "digital-annual" }, createdAt: daysAgo(between(0, 10), 24) });
  }
  await createMany((d) => db.contactEvent.createMany({ data: d }), eventRows);

  // -------------------------------------------------------------- articles
  await db.contentItem.createMany({
    data: ARTICLES.map(([ext, title, section, imageUrl], i) => ({
      externalId: ext, title, section, imageUrl, url: `https://news.example.com/${section}/${ext.slice(2)}`,
      summary: `${title}. Full coverage, analysis and live updates.`, tags: [section], language: "en", publishedAt: daysAgo(i * 0.7, 6),
    })),
  });

  // -------------------------------------------------------------- newsletters + topics
  const groupDefs = [
    ["Breaking news", "breaking", false, "Major stories as they happen", null],
    ["Markets", "markets", false, "Rates, stocks and the economy", "markets"],
    ["Sport", "sport", false, "Results and big moments", "sport"],
    ["Morning Briefing", "morning-briefing", true, "The five stories to know, every morning at 7", null],
    ["Markets Daily", "markets-daily", true, "Close of trading: rates, stocks and the economy", "markets"],
    ["Tech Weekly", "tech-weekly", true, "AI, chips and the companies behind them, every Friday", "technology"],
    ["Climate Check", "climate-check", true, "The week in climate science and policy", "climate"],
  ] as const;
  const groups: Record<string, string> = {};
  const stateRows: Prisma.SubscriptionStateCreateManyInput[] = [];
  for (const [name, slug, optIn, description, section] of groupDefs) {
    const g = await db.subscriptionGroup.create({ data: { name, slug, optIn, description } });
    groups[slug] = g.id;
    for (const r of readers) {
      if (optIn) {
        const p = slug === "morning-briefing" ? 0.42 : section && r.interests.includes(section) ? 0.55 : 0.06;
        if (chance(p)) stateRows.push({ groupId: g.id, contactId: r.id, subscribed: true });
      } else if (chance(0.04)) stateRows.push({ groupId: g.id, contactId: r.id, subscribed: false }); // opted out of a topic
    }
  }
  await createMany((d) => db.subscriptionState.createMany({ data: d }), stateRows);
  const subscribed = (slug: string) => new Set(stateRows.filter((s) => s.groupId === groups[slug] && s.subscribed).map((s) => s.contactId));
  const optedOut = (slug: string) => new Set(stateRows.filter((s) => s.groupId === groups[slug] && !s.subscribed).map((s) => s.contactId));

  // -------------------------------------------------------------- segments
  const seg = async (name: string, filters: object[], tags: string[]) => (await db.segment.create({ data: { name, filters: filters as Prisma.InputJsonValue, tags } })).id;
  const segments = {
    subscribers: await seg("Paying subscribers", [{ field: "attributes.plan", op: "eq", value: "subscriber" }], ["revenue"]),
    trials: await seg("Trial readers", [{ field: "attributes.plan", op: "eq", value: "trial" }], ["revenue", "conversion"]),
    politics: await seg("Politics followers", [{ field: "attributes.interests", op: "contains", value: "politics" }], ["editorial"]),
    markets: await seg("Markets readers", [{ field: "attributes.interests", op: "contains", value: "markets" }], ["editorial"]),
    ios: await seg("iOS app users", [{ field: "attributes.platform", op: "eq", value: "ios" }], ["platform"]),
    german: await seg("German-language readers", [{ field: "language", op: "eq", value: "de" }], ["localisation"]),
    engaged: await seg("Heavy readers (30+ articles a month)", [{ field: "attributes.articlesRead30d", op: "gt", value: 30 }], ["engagement"]),
    lapsed: await seg("Never read an article", [{ field: "event.article_read", op: "neq" }], ["re-engagement"]),
  };
  const inSegment = {
    subscribers: (r: Reader) => r.plan === "subscriber",
    trials: (r: Reader) => r.plan === "trial",
    politics: (r: Reader) => r.interests.includes("politics"),
    markets: (r: Reader) => r.interests.includes("markets"),
  };

  // -------------------------------------------------------------- templates
  const T = async (data: Prisma.MessageTemplateCreateInput) => (await db.messageTemplate.create({ data })).id;
  const tpl = {
    breaking: await T({ name: "Breaking · election result", channel: "FCM", pushTitle: "BREAKING: Final seat called", pushBody: "{{firstName}}, the coalition arithmetic is settled. Read the full results and analysis.", pushUrl: "https://news.example.com/politics/result", pushImageUrl: ARTICLES[1][3], pushPriority: "HIGH", pushCollapseKey: "election-result", pushTtlSeconds: 3600, tags: ["breaking", "politics"] }),
    rates: await T({ name: "Breaking · rates decision", channel: "FCM", pushTitle: "Central bank holds rates", pushBody: "Policymakers signal cuts next year. What it means for mortgages and markets.", pushUrl: "https://news.example.com/markets/rates", pushImageUrl: ARTICLES[2][3], pushPriority: "HIGH", tags: ["breaking", "markets"] }),
    briefing: await T({ name: "Newsletter · Morning Briefing", channel: "FCM", pushTitle: "Your Morning Briefing", pushBody: "Good morning {{firstName}}: ceasefire holds, rates on hold, and a marathon record.", pushUrl: "https://news.example.com/briefing", pushPriority: "NORMAL", tags: ["newsletter"], translations: { de: { pushTitle: "Ihr Morgenbriefing", pushBody: "Guten Morgen {{firstName}}: Waffenruhe hält, Zinsen unverändert, Marathon-Weltrekord." }, fr: { pushTitle: "Votre briefing du matin", pushBody: "Bonjour {{firstName}} : le cessez-le-feu tient, taux inchangés, record du marathon." } } }),
    techA: await T({ name: "Tech Weekly · A (headline)", channel: "FCM", pushTitle: "Tech Weekly: chipmakers rally on record AI orders", pushBody: "Plus: what the new AI safety law means for start-ups.", pushUrl: "https://news.example.com/technology/weekly", pushPriority: "NORMAL", tags: ["newsletter", "ab-test"] }),
    techB: await T({ name: "Tech Weekly · B (question)", channel: "FCM", pushTitle: "Who wins from the AI chip boom?", pushBody: "{{firstName}}, this week's Tech Weekly has the answer, and the law that could change it.", pushUrl: "https://news.example.com/technology/weekly", pushPriority: "NORMAL", tags: ["newsletter", "ab-test"] }),
    marketsEmail: await T({ name: "Markets Daily · email", channel: "EMAIL", subject: "Markets Daily: oil climbs as supply talks stall", htmlBody: "<h1>Markets Daily</h1><p>Hi {{firstName}},</p><p>Oil rose 3% after supply talks stalled. Chipmakers extended their rally.</p><p><a href=\"https://news.example.com/markets\">Read today's edition</a></p>", tags: ["newsletter"] }),
    welcome: await T({ name: "Welcome · in-app", channel: "IN_APP", pushTitle: "Welcome to Dispatch News", pushBody: "Pick the topics you care about and we'll tailor your feed and alerts.", pushUrl: "app://settings/topics", pushImageUrl: "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800", inAppLayout: "MODAL", inAppButtons: [{ label: "Choose topics", url: "app://settings/topics" }, { label: "Later" }], inAppExpiresHours: 168, tags: ["onboarding"] }),
    electionCard: await T({ name: "Card · election night live", channel: "CONTENT_CARD", pushTitle: "Election night — live", pushBody: "Results as they're declared, seat by seat.", pushUrl: "https://news.example.com/live/election", pushImageUrl: ARTICLES[0][3], cardStyle: "CAPTIONED_IMAGE", cardPinned: true, cardCategory: "live", cardDismissible: false, inAppExpiresHours: 48, tags: ["live", "politics"] }),
    trialOffer: await T({ name: "Card · subscribe offer", channel: "CONTENT_CARD", pushTitle: "Keep reading for €1 a week", pushBody: "Your trial ends soon. Subscribe now and keep unlimited access.", pushUrl: "app://subscribe", cardStyle: "CLASSIC", cardCategory: "offers", tags: ["conversion"] }),
    trialPush: await T({ name: "Trial · last day reminder", channel: "FCM", pushTitle: "Your trial ends tomorrow", pushBody: "{{firstName}}, keep unlimited access for €1 a week.", pushUrl: "app://subscribe", pushPriority: "NORMAL", tags: ["conversion"] }),
    nudge: await T({ name: "Nudge · catch up", channel: "FCM", pushTitle: "You missed these", pushBody: "Three stories our editors picked for you this week.", pushUrl: "app://foryou", pushPriority: "NORMAL", tags: ["re-engagement"] }),
    sms: await T({ name: "SMS · breaking", channel: "SMS", smsBody: "Dispatch News: Final seat called in the national election. news.example.com/r  Reply STOP to opt out", tags: ["breaking"] }),
  };

  // -------------------------------------------------------------- campaigns + messages
  const msgRows: Prisma.MessageCreateManyInput[] = [];
  type CampaignSpec = {
    name: string; channel: Channel; daysAgo: number; audience: (r: Reader) => boolean; open: number; click: number;
    variants: { name: string; templateId: string; weight: number; lift?: number }[];
    data: Partial<Prisma.CampaignUncheckedCreateInput>; allPlatforms?: boolean;
  };
  async function sentCampaign(s: CampaignSpec) {
    const launchedAt = daysAgo(s.daysAgo, 2);
    const c = await db.campaign.create({
      data: {
        name: s.name, channel: s.channel, status: "COMPLETED", launchedAt, completedAt: minutesAfter(launchedAt, 2, 9),
        allPushPlatforms: s.allPlatforms ?? false, createdAt: minutesAfter(launchedAt, -90, -20), ...s.data,
        variants: { create: s.variants.map((v) => ({ name: v.name, templateId: v.templateId, weight: v.weight })) },
      } as Prisma.CampaignUncheckedCreateInput,
      include: { variants: true },
    });
    const holdout = (c.controlGroupPct ?? 0) / 100;
    for (const r of readers.filter(s.audience)) {
      const vi = rand() * 100 < s.variants[0].weight ? 0 : 1;
      const variant = c.variants[Math.min(vi, c.variants.length - 1)];
      const lift = s.variants[Math.min(vi, s.variants.length - 1)].lift ?? 1;
      const targets: { channel: Channel; subId: string | null }[] =
        s.channel === "EMAIL" ? (r.email ? [{ channel: "EMAIL", subId: null }] : [])
        : s.channel === "SMS" ? []
        : s.channel === "IN_APP" || s.channel === "CONTENT_CARD" ? [{ channel: s.channel, subId: null }]
        : (subsOf.get(r.id) ?? []).filter((x) => s.allPlatforms || x.channel === s.channel).map((x) => ({ channel: x.channel as Channel, subId: x.id! }));
      for (const t of targets) {
        if (chance(holdout)) {
          msgRows.push({ id: id("m"), campaignId: c.id, variantId: variant.id, contactId: r.id, channel: t.channel, status: "HELD_OUT", createdAt: launchedAt });
          continue;
        }
        const sentAt = minutesAfter(launchedAt, 0, 6);
        const failed = chance(0.018);
        const p = Math.min(0.95, s.open * lift * (0.5 + r.engagement));
        const opened = !failed && chance(p);
        const clicked = opened && chance(s.click / Math.max(s.open, 0.01));
        const openedAt = opened ? minutesAfter(sentAt, 1, 600) : null;
        msgRows.push({
          id: id("m"), campaignId: c.id, variantId: variant.id, contactId: r.id, pushSubscriptionId: t.subId, channel: t.channel,
          status: (failed ? "FAILED" : "DELIVERED") as MessageStatus, error: failed ? pick(["NotRegistered: token is no longer valid", "Unregistered (410)"]) : null,
          attempts: 1, sentAt, deliveredAt: failed ? null : minutesAfter(sentAt, 0, 1), openedAt,
          clickedAt: clicked ? minutesAfter(openedAt!, 0, 3) : null,
          convertedAt: c.conversionEvent && clicked && chance(0.25) ? minutesAfter(openedAt!, 5, 600) : null,
          readAt: (t.channel === "IN_APP" || t.channel === "CONTENT_CARD") && opened ? openedAt : null,
          createdAt: launchedAt,
        });
      }
    }
    return c.id;
  }

  const notOut = (slug: string) => { const out = optedOut(slug); return (r: Reader) => !out.has(r.id); };
  const subs = (slug: string) => { const s = subscribed(slug); return (r: Reader) => s.has(r.id); };

  await sentCampaign({ name: "Breaking: final seat called — every device", channel: "FCM", daysAgo: 1, audience: notOut("breaking"), open: 0.24, click: 0.11, allPlatforms: true,
    variants: [{ name: "A", templateId: tpl.breaking, weight: 100 }], data: { subscriptionGroupId: groups.breaking, bypassDeliveryRules: true, tags: ["breaking", "politics"] } });
  await sentCampaign({ name: "Breaking: central bank holds rates", channel: "FCM", daysAgo: 6, audience: (r) => notOut("markets")(r) && inSegment.markets(r), open: 0.21, click: 0.09, allPlatforms: true,
    variants: [{ name: "A", templateId: tpl.rates, weight: 100 }], data: { segmentId: segments.markets, subscriptionGroupId: groups.markets, bypassDeliveryRules: true, tags: ["breaking", "markets"] } });
  for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
    if (d % 7 === 5 || d % 7 === 6) continue; // weekdays only
    await sentCampaign({ name: `Morning Briefing · ${new Date(NOW - d * DAY).toISOString().slice(0, 10)}`, channel: "FCM", daysAgo: d + 0.3, audience: subs("morning-briefing"), open: 0.17, click: 0.06, allPlatforms: true,
      variants: [{ name: "A", templateId: tpl.briefing, weight: 100 }], data: { subscriptionGroupId: groups["morning-briefing"], sendTimeOptimization: d < 7, tags: ["newsletter"] } });
  }
  await sentCampaign({ name: "Tech Weekly · headline vs question (A/B)", channel: "FCM", daysAgo: 3, audience: subs("tech-weekly"), open: 0.16, click: 0.07, allPlatforms: true,
    variants: [{ name: "A", templateId: tpl.techA, weight: 50 }, { name: "B", templateId: tpl.techB, weight: 50, lift: 1.38 }],
    data: { subscriptionGroupId: groups["tech-weekly"], controlGroupPct: 10, conversionEvent: "article_read", tags: ["newsletter", "ab-test"] } });
  await sentCampaign({ name: "Markets Daily · email edition", channel: "EMAIL", daysAgo: 2, audience: subs("markets-daily"), open: 0.38, click: 0.09,
    variants: [{ name: "A", templateId: tpl.marketsEmail, weight: 100 }], data: { subscriptionGroupId: groups["markets-daily"], tags: ["newsletter"] } });
  await sentCampaign({ name: "Election night live card", channel: "CONTENT_CARD", daysAgo: 2, audience: () => true, open: 0.45, click: 0.14,
    variants: [{ name: "A", templateId: tpl.electionCard, weight: 100 }], data: { tags: ["live", "politics"] } });
  await sentCampaign({ name: "Trial readers · subscribe offer", channel: "CONTENT_CARD", daysAgo: 5, audience: inSegment.trials, open: 0.52, click: 0.16,
    variants: [{ name: "A", templateId: tpl.trialOffer, weight: 100 }], data: { segmentId: segments.trials, conversionEvent: "subscribed", conversionWindowHours: 168, tags: ["conversion"] } });

  // Not yet sent: event-triggered, scheduled, recurring, draft
  await db.campaign.create({ data: { name: "Welcome pop-up on sign-up", channel: "IN_APP", status: "RUNNING", trigger: "EVENT", triggerEvent: "signed_up", launchedAt: daysAgo(20), tags: ["onboarding"], variants: { create: [{ templateId: tpl.welcome }] } } });
  await db.campaign.create({ data: { name: "Climate Check · Sunday edition", channel: "FCM", status: "SCHEDULED", scheduledAt: new Date(NOW + 2 * DAY), allPushPlatforms: true, subscriptionGroupId: groups["climate-check"], recurrence: "WEEKLY", tags: ["newsletter"], variants: { create: [{ templateId: tpl.briefing }] } } });
  await db.campaign.create({ data: { name: "German readers · Morning Briefing (de)", channel: "FCM", status: "SCHEDULED", scheduledAt: new Date(NOW + 0.6 * DAY), segmentId: segments.german, recurrence: "DAILY", allPushPlatforms: true, tags: ["newsletter", "localisation"], variants: { create: [{ templateId: tpl.briefing }] } } });
  await db.campaign.create({ data: { name: "Lapsed readers · catch-up nudge", channel: "FCM", status: "DRAFT", segmentId: segments.lapsed, allPushPlatforms: true, sendTimeOptimization: true, tags: ["re-engagement"], variants: { create: [{ templateId: tpl.nudge }] } } });
  await db.campaign.create({ data: { name: "SMS breaking alert (needs Twilio)", channel: "SMS", status: "DRAFT", subscriptionGroupId: groups.breaking, bypassDeliveryRules: true, tags: ["breaking"], variants: { create: [{ templateId: tpl.sms }] } } });

  await createMany((d) => db.message.createMany({ data: d }), msgRows);

  // -------------------------------------------------------------- journeys
  type Node = { key: string; type: string; label?: string; channel?: Channel; templateId?: string; config?: object; next: Record<string, unknown> };
  async function journey(name: string, data: Partial<Prisma.JourneyUncheckedCreateInput>, nodes: Node[], entrants: Reader[], decide: (n: Node, r: Reader) => string | "wait" | undefined) {
    const j = await db.journey.create({ data: { name, status: "ACTIVE", entryKey: nodes[0].key, ...data } as Prisma.JourneyUncheckedCreateInput });
    await db.journeyStep.createMany({
      data: nodes.map((n, order) => ({ journeyId: j.id, order, key: n.key, type: n.type, label: n.label ?? null, channel: n.channel ?? null, templateId: n.templateId ?? null, config: (n.config ?? undefined) as Prisma.InputJsonValue, next: n.next as Prisma.InputJsonValue })),
    });
    const steps = await db.journeyStep.findMany({ where: { journeyId: j.id } });
    const stepId = new Map(steps.map((s) => [s.key!, s.id]));
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const runs: Prisma.JourneyRunCreateManyInput[] = [];
    const visits: Prisma.JourneyVisitCreateManyInput[] = [];
    const jmsgs: Prisma.MessageCreateManyInput[] = [];
    for (const r of entrants) {
      const runId = id("r");
      let at = daysAgo(between(0, 12), 24);
      const start = at;
      let key: string | undefined = nodes[0].key;
      let waiting: Node | undefined;
      let exitReason = "completed";
      for (let hops = 0; key && hops < 20; hops++) {
        const n: Node = byKey.get(key)!;
        at = minutesAfter(at, 0, 30);
        if (n.type === "EXIT") { visits.push({ journeyId: j.id, runId, nodeKey: n.key, at }); exitReason = "exit_node"; key = undefined; break; }
        if (n.type === "MESSAGE") {
          visits.push({ journeyId: j.id, runId, nodeKey: n.key, at });
          const ch = n.channel!;
          const sub = (subsOf.get(r.id) ?? [])[0];
          const pushy = ch === "FCM" || ch === "APNS" || ch === "WEB_PUSH";
          if (!pushy || sub) {
            const opened = chance(0.25 + r.engagement * 0.4);
            jmsgs.push({ id: id("m"), journeyStepId: stepId.get(n.key), contactId: r.id, pushSubscriptionId: pushy ? sub?.id : null, channel: pushy ? (sub!.channel as Channel) : ch, status: "DELIVERED", attempts: 1, sentAt: at, deliveredAt: at, openedAt: opened ? minutesAfter(at, 1, 300) : null, clickedAt: opened && chance(0.4) ? minutesAfter(at, 5, 320) : null, createdAt: at });
          }
          key = (n.next.default as string | null) ?? undefined;
          continue;
        }
        if (n.type === "DELAY") { visits.push({ journeyId: j.id, runId, nodeKey: n.key, at }); at = minutesAfter(at, (n.config as { minutes: number }).minutes, (n.config as { minutes: number }).minutes); key = (n.next.default as string | null) ?? undefined; if (at.getTime() > NOW) { waiting = n; break; } continue; }
        const choice = decide(n, r);
        if (n.type === "WAIT_EVENT") {
          visits.push({ journeyId: j.id, runId, nodeKey: n.key, at });
          if (choice === "wait") { waiting = n; break; }
          at = minutesAfter(at, 10, 2000);
          visits.push({ journeyId: j.id, runId, nodeKey: n.key, branch: choice, at });
          key = (n.next[choice!] as string | null) ?? undefined;
          continue;
        }
        visits.push({ journeyId: j.id, runId, nodeKey: n.key, branch: choice, at });
        key = n.type === "RANDOM" ? ((n.next.branches as (string | null)[])[Number(choice)] ?? undefined) : ((n.next[choice!] as string | null) ?? undefined);
      }
      const done = !waiting;
      runs.push({
        id: runId, journeyId: j.id, contactId: r.id, createdAt: start,
        currentKey: waiting?.key ?? null,
        waitingEvent: waiting?.type === "WAIT_EVENT" ? (waiting.config as { event: string }).event : null,
        waitUntil: waiting?.type === "WAIT_EVENT" ? new Date(NOW + between(60, 3 * 24 * 60) * 60_000) : null,
        completedAt: done ? at : null, exitReason: done ? exitReason : null,
      });
    }
    await createMany((d) => db.journeyRun.createMany({ data: d }), runs);
    await createMany((d) => db.journeyVisit.createMany({ data: d }), visits);
    await createMany((d) => db.message.createMany({ data: d }), jmsgs);
    return j.id;
  }
  const reachable = (r: Reader) => (subsOf.get(r.id) ?? []).length > 0;

  await journey("Election night: follow or nudge", { triggerEvent: "election_followed", exitEvent: "unsubscribed" }, [
    { key: "welcome", type: "MESSAGE", channel: "IN_APP", templateId: tpl.welcome, next: { default: "wait" } },
    { key: "wait", type: "WAIT_EVENT", config: { event: "article_read", timeoutMinutes: 720 }, next: { event: "push", timeout: "card" } },
    { key: "push", type: "CONDITION", config: { match: "all", rules: [{ type: "event", name: "app_open", withinHours: 168 }] }, next: { yes: "alert", no: "card" } },
    { key: "alert", type: "MESSAGE", channel: "FCM", templateId: tpl.breaking, config: { allPushPlatforms: true }, next: {} },
    { key: "card", type: "MESSAGE", channel: "CONTENT_CARD", templateId: tpl.electionCard, next: {} },
  ], readers.filter((r) => r.interests.includes("politics") && chance(0.6)), (n, r) =>
    n.type === "WAIT_EVENT" ? (chance(0.12) ? "wait" : chance(0.35 + r.engagement * 0.5) ? "event" : "timeout") : reachable(r) ? "yes" : "no");

  await journey("New reader onboarding (A/B: alert vs card)", { triggerEvent: "signed_up", exitEvent: "subscribed" }, [
    { key: "hello", type: "MESSAGE", channel: "IN_APP", templateId: tpl.welcome, next: { default: "day1" } },
    { key: "day1", type: "DELAY", config: { minutes: 1440 }, next: { default: "split" } },
    { key: "split", type: "RANDOM", config: { weights: [50, 50] }, next: { branches: ["pushpick", "cardpick"] } },
    { key: "pushpick", type: "MESSAGE", channel: "FCM", templateId: tpl.nudge, config: { allPushPlatforms: true }, next: { default: "read" } },
    { key: "cardpick", type: "MESSAGE", channel: "CONTENT_CARD", templateId: tpl.electionCard, next: { default: "read" } },
    { key: "read", type: "WAIT_EVENT", config: { event: "article_read", timeoutMinutes: 4320 }, next: { event: "done", timeout: "nudge" } },
    { key: "nudge", type: "MESSAGE", channel: "FCM", templateId: tpl.nudge, config: { allPushPlatforms: true }, next: {} },
    { key: "done", type: "EXIT", next: {} },
  ], readers.filter((r) => r.createdAt.getTime() > NOW - 30 * DAY || chance(0.08)), (n, r) =>
    n.type === "RANDOM" ? (chance(0.5) ? "0" : "1") : chance(0.15) ? "wait" : chance(0.3 + r.engagement * 0.6) ? "event" : "timeout");

  await journey("Trial to paid", { segmentId: segments.trials, exitEvent: "subscribed" }, [
    { key: "offer", type: "MESSAGE", channel: "CONTENT_CARD", templateId: tpl.trialOffer, next: { default: "wait3" } },
    { key: "wait3", type: "DELAY", config: { minutes: 4320 }, next: { default: "check" } },
    { key: "check", type: "CONDITION", config: { match: "all", rules: [{ type: "event", name: "subscribed" }] }, next: { yes: "thanks", no: "remind" } },
    { key: "remind", type: "MESSAGE", channel: "FCM", templateId: tpl.trialPush, config: { allPushPlatforms: true }, next: {} },
    { key: "thanks", type: "EXIT", next: {} },
  ], readers.filter((r) => r.plan === "trial"), () => (chance(0.28) ? "yes" : "no"));

  const draft = await db.journey.create({ data: { name: "Lapsed reader win-back (draft)", status: "DRAFT", segmentId: segments.lapsed, entryKey: "nudge" } });
  await db.journeyStep.createMany({ data: [
    { journeyId: draft.id, order: 0, key: "nudge", type: "MESSAGE", channel: "FCM", templateId: tpl.nudge, config: { allPushPlatforms: true }, next: { default: "wait" } },
    { journeyId: draft.id, order: 1, key: "wait", type: "WAIT_EVENT", config: { event: "app_open", timeoutMinutes: 10080 }, next: { event: null, timeout: "email" } },
    { journeyId: draft.id, order: 2, key: "email", type: "MESSAGE", channel: "EMAIL", templateId: tpl.marketsEmail, next: {} },
  ] });

  const [contacts, devices, messages, runs] = await Promise.all([db.contact.count(), db.pushSubscription.count(), db.message.count(), db.journeyRun.count()]);
  console.log(`Demo workspace ready: ${contacts} readers, ${devices} devices, ${eventRows.length} events, ${Object.keys(segments).length} segments, ${Object.keys(tpl).length} templates, ${await db.campaign.count()} campaigns, ${messages} messages, 4 journeys (${runs} runs).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
