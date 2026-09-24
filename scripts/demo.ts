/**
 * Demo control for the example apps (examples/*). Run the console and a mock-provider worker first:
 *
 *   npm run dev
 *   npm run worker:demo        (= PUSH_PROVIDER_MODE=mock DEMO_DEVICE_RELAY=true npm run worker:start)
 *
 *   npm run demo -- setup                       keys, topics, newsletters, articles, templates, campaigns → examples/demo-config.json
 *   npm run demo -- breaking "Headline" [--section world]
 *                                               publish an article → auto-send to every demo device
 *   npm run demo -- foryou                      personalised "recommended for you" push to every demo device
 *   npm run demo -- newsletter morning-briefing launch that newsletter's campaign (same job as the console's
 *                                               Launch button) → only its subscribers' phones get it
 *   npm run demo -- inapp                       welcome pop-up + message-centre card for every demo user
 *   npm run demo -- cards                       content cards: a pinned election-night card + a personalised pick
 *   npm run demo -- live start|update|end [--progress 0.4]
 *                                               election-night Live Activity / Live Update
 *   npm run demo -- status                      who is registered, what they opened
 *
 * Real FCM/APNs delivery needs your Firebase project and Apple push key. For
 * simulators the worker runs the real pipeline (campaign → messages → render →
 * mock provider → tracking) and, with DEMO_DEVICE_RELAY=true, hands the exact
 * provider payload to the device: `xcrun simctl push` (iOS simulator) and an
 * adb broadcast (Android emulator) — see src/lib/channels/push/demoRelay.ts.
 * That also covers campaigns launched from the console. Taps, reads and in-app
 * clicks flow back to the real API.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db";
import { generateApiKey, hashKey } from "../src/lib/apiAuth";
import { fanOut } from "../src/lib/campaignFanOut";
import { broadcastToAndroidEmulator, demoDeviceWhere } from "../src/lib/channels/push/demoRelay";
import { enqueue } from "../src/lib/queue/enqueue";
import { upsertItems } from "../src/lib/feeds";
import { audienceTokens, queueLiveEvent } from "../src/lib/liveActivities";

const CONFIG = join(process.cwd(), "examples", "demo-config.json");
const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const log = (...a: unknown[]) => console.log("›", ...a);

// ------------------------------------------------------------------ setup

const ARTICLES = [
  ["a-rates", "Central bank holds rates, signals cuts next year", "markets", ["rates", "economy"]],
  ["a-oil", "Oil climbs as supply talks stall", "markets", ["energy"]],
  ["a-chips", "Chipmakers rally on record AI orders", "technology", ["ai", "semiconductors"]],
  ["a-ai-law", "Parliament passes landmark AI safety law", "technology", ["ai", "regulation"]],
  ["a-final", "Late winner settles a dramatic cup final", "sport", ["football"]],
  ["a-marathon", "Marathon world record falls in Berlin", "sport", ["athletics"]],
  ["a-summit", "Leaders agree climate finance deal at summit", "world", ["climate"]],
  ["a-election", "Polls open in a knife-edge national election", "world", ["elections"]],
] as const;

/** Configured in the backend; each demo app subscribes to a different pair (examples/README.md). */
const NEWSLETTERS = [
  ["morning-briefing", "Morning Briefing", "The five stories to know, every morning at 7", "world"],
  ["markets-daily", "Markets Daily", "Close of trading: rates, stocks and the economy", "markets"],
  ["sport-wrap", "Sport Wrap", "Tonight's results and the big moments", "sport"],
  ["tech-weekly", "Tech Weekly", "AI, chips and the companies behind them — Fridays", "technology"],
] as const;

async function upsertTemplate(name: string, data: Record<string, unknown>) {
  const existing = await db.messageTemplate.findFirst({ where: { name } });
  return existing
    ? db.messageTemplate.update({ where: { id: existing.id }, data })
    : db.messageTemplate.create({ data: { name, ...(data as { channel: "FCM" }) } });
}

async function upsertCampaign(
  name: string,
  channel: "FCM" | "APNS" | "IN_APP" | "CONTENT_CARD",
  templateId: string,
  opts: { allPushPlatforms?: boolean; subscriptionGroupId?: string; bypassDeliveryRules?: boolean; tags?: string[] } = {}
) {
  const data = { allPushPlatforms: false, bypassDeliveryRules: true, ...opts };
  const existing = await db.campaign.findFirst({ where: { name }, include: { variants: true } });
  if (existing) return db.campaign.update({ where: { id: existing.id }, data, include: { variants: true } });
  return db.campaign.create({
    data: { name, channel, ...data, variants: { create: [{ templateId, weight: 100 }] } },
    include: { variants: true },
  });
}

async function setup() {
  // Re-running setup keeps the keys already built into the example apps
  const previous = existsSync(CONFIG) ? (JSON.parse(readFileSync(CONFIG, "utf8")) as { sdkKey?: string; serverKey?: string }) : {};
  const keys: Record<string, string> = {};
  for (const [label, scope] of [["demo-apps (SDK)", "SDK"], ["demo-backend (server)", "SERVER"]] as const) {
    const kept = scope === "SDK" ? previous.sdkKey : previous.serverKey;
    if (kept && (await db.apiKey.findFirst({ where: { keyHash: hashKey(kept), revokedAt: null } }))) {
      keys[scope] = kept;
      continue;
    }
    const { raw, prefix, keyHash } = generateApiKey(scope);
    await db.apiKey.create({ data: { name: label, prefix, keyHash, scope } });
    keys[scope] = raw;
  }

  // Topics: on for everyone until they opt out
  for (const [slug, name, description] of [
    ["breaking", "Breaking news", "Major stories as they happen"],
    ["markets", "Markets", "Rates, stocks and the economy"],
    ["sport", "Sport", "Results and big moments"],
  ]) {
    await db.subscriptionGroup.upsert({ where: { name }, create: { name, slug, description }, update: { slug, description, optIn: false } });
  }
  // Newsletters: only for people who subscribe
  const letters: Record<string, string> = {};
  for (const [slug, name, description] of NEWSLETTERS) {
    const g = await db.subscriptionGroup.upsert({ where: { name }, create: { name, slug, description, optIn: true }, update: { slug, description, optIn: true } });
    letters[slug] = g.id;
  }

  await upsertItems(
    ARTICLES.map(([id, title, section, tags], i) => ({
      externalId: id,
      title,
      url: `https://news.example/${id}`,
      summary: null,
      imageUrl: `https://picsum.photos/seed/${id}/800/450`,
      section,
      tags: [...tags],
      language: "en",
      publishedAt: new Date(Date.now() - (i + 1) * 45 * 60_000),
    }))
  );

  const breakingPush = {
    pushTitle: "Breaking: {{item.title}}",
    pushBody: "Tap for the latest from the {{item.section}} desk.",
    pushUrl: "dispatchdemo://article/{{item.id}}",
    pushImageUrl: "{{item.imageUrl}}",
    pushPriority: "HIGH",
    pushCollapseKey: "breaking",
    pushTtlSeconds: 3600,
  };
  const forYouPush = {
    pushTitle: "Picked for you, {{firstName}}",
    pushBody: "{{recommendation.1.title}}",
    pushUrl: "dispatchdemo://article/{{recommendation.1.id}}",
    pushImageUrl: "{{recommendation.1.imageUrl}}",
    pushPriority: "NORMAL",
  };
  // One template + campaign per message, sent to every phone (iOS, Android, web)
  const breakingGroup = await db.subscriptionGroup.findUniqueOrThrow({ where: { name: "Breaking news" } });
  const ids: Record<string, string> = {};
  const b = await upsertTemplate("Demo · breaking", { channel: "FCM", ...breakingPush });
  ids.breaking = (await upsertCampaign("Demo · breaking", "FCM", b.id, { allPushPlatforms: true, subscriptionGroupId: breakingGroup.id })).id;
  const f = await upsertTemplate("Demo · for you", { channel: "FCM", ...forYouPush });
  ids.forYou = (await upsertCampaign("Demo · for you", "FCM", f.id, { allPushPlatforms: true })).id;
  for (const [slug, name, , section] of NEWSLETTERS) {
    const t = await upsertTemplate(`Newsletter · ${name}`, {
      channel: "FCM",
      pushTitle: name,
      pushBody: "{{trending.1.title}} — and more in today's edition",
      pushUrl: "dispatchdemo://article/{{trending.1.id}}",
      pushImageUrl: "{{trending.1.imageUrl}}",
      pushPriority: "NORMAL",
      pushCollapseKey: slug,
    });
    ids[`newsletter:${slug}`] = (
      await upsertCampaign(`${name} (newsletter)`, "FCM", t.id, {
        allPushPlatforms: true, subscriptionGroupId: letters[slug], bypassDeliveryRules: false, tags: ["newsletter", section],
      })
    ).id;
  }
  const welcome = await upsertTemplate("Demo · welcome (in-app)", {
    channel: "IN_APP",
    inAppLayout: "MODAL",
    pushTitle: "Welcome to Dispatch News",
    pushBody: "Your briefing starts with: {{trending.1.title}}",
    pushImageUrl: "{{trending.1.imageUrl}}",
    pushUrl: "dispatchdemo://article/{{trending.1.id}}",
    inAppButtons: [
      { label: "Read it", url: "dispatchdemo://article/{{trending.1.id}}" },
      { label: "Later", url: "" },
    ],
  });
  ids.inApp = (await upsertCampaign("Demo · welcome (in-app)", "IN_APP", welcome.id)).id;

  // Content cards: one pinned, not dismissible; one personalised and dismissible
  const liveCard = await upsertTemplate("Demo · card · election night", {
    channel: "CONTENT_CARD",
    cardStyle: "CAPTIONED_IMAGE",
    cardPinned: true,
    cardDismissible: false,
    cardCategory: "live",
    pushTitle: "Election night — live",
    pushBody: "Results as they're declared, seat by seat.",
    pushImageUrl: "https://picsum.photos/seed/election-night/800/400",
    pushUrl: "dispatchdemo://article/a-election",
    inAppButtons: [{ label: "Follow live", url: "dispatchdemo://article/a-election" }],
    inAppExpiresHours: 48,
  });
  ids.cardLive = (await upsertCampaign("Demo · card · election night", "CONTENT_CARD", liveCard.id)).id;
  const pickCard = await upsertTemplate("Demo · card · picked for you", {
    channel: "CONTENT_CARD",
    cardStyle: "CLASSIC",
    pushTitle: "Picked for you, {{firstName}}",
    pushBody: "{{recommendation.1.title}}",
    pushImageUrl: "{{recommendation.1.imageUrl}}",
    pushUrl: "dispatchdemo://article/{{recommendation.1.id}}",
    inAppButtons: [{ label: "Read", url: "" }],
  });
  ids.cardPick = (await upsertCampaign("Demo · card · picked for you", "CONTENT_CARD", pickCard.id)).id;

  // Console target for "send to the demo phones": the three example apps' signed-in readers
  const segName = "Demo readers (example apps)";
  if (!(await db.segment.findFirst({ where: { name: segName } }))) {
    await db.segment.create({ data: { name: segName, filters: [{ field: "externalId", op: "contains", value: "demo-reader" }] } });
  }

  mkdirSync(join(process.cwd(), "examples"), { recursive: true });
  const cfg = {
    baseUrl: BASE_URL,
    // Android emulator reaches the host machine at 10.0.2.2
    androidBaseUrl: BASE_URL.replace("localhost", "10.0.2.2").replace("127.0.0.1", "10.0.2.2"),
    sdkKey: keys.SDK,
    serverKey: keys.SERVER,
    campaigns: ids,
  };
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");
  log(`wrote ${CONFIG}`);
  log(`SDK key for the apps: ${keys.SDK}`);
  log(`topics, ${NEWSLETTERS.length} newsletters, 8 articles, breaking / for-you / newsletter / in-app campaigns ready`);
}

// --------------------------------------------------------- device delivery

function config() {
  if (!existsSync(CONFIG)) throw new Error("run `npm run demo -- setup` first");
  return JSON.parse(readFileSync(CONFIG, "utf8")) as { campaigns: Record<string, string> };
}

/** Demo devices: every active push subscription registered by the example apps. */
async function demoSubscriptions() {
  return db.pushSubscription.findMany({
    where: { isActive: true, channel: { in: ["FCM", "APNS"] }, ...demoDeviceWhere },
    include: { contact: true },
  });
}

async function waitSent(ids: string[], timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const pending = await db.message.count({ where: { id: { in: ids }, status: { in: ["QUEUED", "SENDING"] } } });
    if (!pending) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("messages still queued — is `npm run worker:demo` running?");
}

async function report(ids: string[]) {
  const rows = await db.message.findMany({ where: { id: { in: ids } }, include: { pushSubscription: { select: { platform: true } } } });
  const by = (status: string) => rows.filter((r) => r.status === status);
  const sent = rows.filter((r) => r.status === "SENT" || r.status === "DELIVERED");
  const platforms = [...new Set(sent.map((r) => r.pushSubscription?.platform ?? r.channel))];
  log(`${sent.length} sent${platforms.length ? ` (${platforms.join(", ")})` : ""} — the worker relays them to the simulator / emulator`);
  const suppressed = by("SUPPRESSED");
  if (suppressed.length) log(`${suppressed.length} suppressed: ${[...new Set(suppressed.map((s) => s.error ?? "suppressed"))].join(", ")}`);
  const failed = by("FAILED");
  if (failed.length) log(`${failed.length} failed: ${[...new Set(failed.map((s) => s.error))].join(", ")}`);
}

/** Fan a campaign out to the demo devices only (not every contact), then let the worker send + relay. */
async function sendToDemoDevices(campaignKey: "breaking" | "forYou", contentItemId?: string) {
  const cfg = config();
  const subs = await demoSubscriptions();
  if (!subs.length) return log("no demo devices registered yet — open an example app first");
  const campaign = await db.campaign.findUnique({ where: { id: cfg.campaigns[campaignKey] }, include: { variants: true } });
  if (!campaign) throw new Error("run `npm run demo -- setup` again (campaigns changed)");
  await db.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING", lastRunAt: new Date(), launchedAt: campaign.launchedAt ?? new Date() } });
  const before = new Date();
  const contacts = [...new Map(subs.map((s) => [s.contactId, {
    id: s.contactId, email: s.contact.email,
    subscriptions: subs.filter((x) => x.contactId === s.contactId).map((x) => ({ id: x.id, channel: x.channel })),
  }])).values()];
  await fanOut(campaign, contacts, new Set(), { contentItemId: contentItemId ?? null });
  const created = (await db.message.findMany({ where: { campaignId: campaign.id, createdAt: { gte: before } }, select: { id: true } })).map((m) => m.id);
  if (!created.length) return log("nothing to send");
  log(`queued ${created.length} message(s); waiting for the worker…`);
  await waitSent(created);
  await report(created);
}

/** Launch a newsletter's campaign exactly like the console's Launch button: the worker resolves the audience. */
async function newsletter(slug: string) {
  const cfg = config();
  const id = cfg.campaigns[`newsletter:${slug}`];
  if (!id) throw new Error(`unknown newsletter "${slug}" — one of: ${NEWSLETTERS.map((n) => n[0]).join(", ")}`);
  const group = await db.subscriptionGroup.findUniqueOrThrow({ where: { slug } });
  const subscribers = await db.subscriptionState.count({ where: { groupId: group.id, subscribed: true } });
  await db.campaign.update({ where: { id }, data: { status: "SCHEDULED", recurrence: "DAILY" } }); // a daily edition may go out again
  const before = new Date();
  await enqueue("LAUNCH_CAMPAIGN", { campaignId: id });
  log(`launched "${group.name}" — ${subscribers} subscriber(s); waiting for the worker…`);
  const until = Date.now() + 30_000;
  let ids: string[] = [];
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 700));
    ids = (await db.message.findMany({ where: { campaignId: id, createdAt: { gte: before } }, select: { id: true } })).map((m) => m.id);
    const c = await db.campaign.findUnique({ where: { id }, select: { status: true } });
    if (ids.length && c?.status !== "SCHEDULED") break;
  }
  if (!ids.length) return log("nobody to send to — subscribe from an app's Alerts / Newsletters screen");
  await waitSent(ids);
  await report(ids);
}

async function breaking(headline: string) {
  const section = flag("section", "world")!;
  const slug = `demo-${Date.now().toString(36)}`;
  const [item] = await upsertItems([
    { externalId: slug, title: headline, url: `https://news.example/${slug}`, summary: null, imageUrl: `https://picsum.photos/seed/${slug}/800/450`, section, tags: ["breaking"], language: "en", publishedAt: new Date() },
  ]);
  log(`published "${headline}" (${section})`);
  await sendToDemoDevices("breaking", item.id);
}

/** Content cards for every demo reader (fan-out to the demo contacts, like inApp). */
async function cards() {
  const cfg = config();
  const subs = await demoSubscriptions();
  const contacts = [...new Map(subs.map((s) => [s.contactId, { id: s.contactId, email: s.contact.email }])).values()];
  if (!contacts.length) return log("no demo users yet — open an example app first");
  const ids: string[] = [];
  for (const key of ["cardLive", "cardPick"]) {
    const campaign = await db.campaign.findUnique({ where: { id: cfg.campaigns[key] }, include: { variants: true } });
    if (!campaign) throw new Error("run `npm run demo -- setup` again (cards were added)");
    await db.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING", lastRunAt: new Date() } });
    const before = new Date();
    await fanOut(campaign, contacts, new Set());
    ids.push(...(await db.message.findMany({ where: { campaignId: campaign.id, createdAt: { gte: before } }, select: { id: true } })).map((m) => m.id));
  }
  await waitSent(ids);
  log(`${ids.length} card(s) in the feeds of ${contacts.length} reader(s) — pull to refresh the For you tab`);
}

async function inApp() {
  const cfg = config();
  const campaign = await db.campaign.findUnique({ where: { id: cfg.campaigns.inApp }, include: { variants: true } });
  if (!campaign) throw new Error("run setup first");
  const subs = await demoSubscriptions();
  const contacts = [...new Map(subs.map((s) => [s.contactId, { id: s.contactId, email: s.contact.email }])).values()];
  if (!contacts.length) return log("no demo users yet — open an example app first");
  await db.campaign.update({ where: { id: campaign.id }, data: { status: "RUNNING", lastRunAt: new Date() } });
  const before = new Date();
  await fanOut(campaign, contacts, new Set());
  const ids = (await db.message.findMany({ where: { campaignId: campaign.id, createdAt: { gte: before } }, select: { id: true } })).map((m) => m.id);
  await waitSent(ids);
  log(`in-app message ready for ${ids.length} user(s) — it pops up on the next inbox refresh`);
}

async function live(event: "start" | "update" | "end") {
  const key = "election-2026";
  const progress = Number(flag("progress", event === "start" ? "0" : event === "end" ? "1" : "0.42"));
  const pct = Math.round(progress * 100);
  const contentState = { title: "Election night", subtitle: event === "end" ? "Result declared" : `${pct}% of votes counted`, progress, leader: "Party A" };
  const activity = await db.liveActivity.upsert({
    where: { key },
    create: { key, activityType: "ElectionAttributes", attributes: { race: "National election" }, contentState },
    update: { contentState, status: event === "end" ? "ENDED" : "ACTIVE", ...(event === "start" ? { endedAt: null } : {}) },
  });
  const tokens = await audienceTokens(activity, event);
  await queueLiveEvent(activity, event, { contentState, alert: event === "update" ? undefined : { title: "Election night", body: contentState.subtitle } }, tokens);
  log(`live ${event}: ${tokens.length} device(s) — ${contentState.subtitle}`);
  // Android emulator: hand the same data message to the app
  const follows = tokens.filter((t) => t.kind === "FOLLOW");
  if (follows.length) {
    const data = { dispatchType: "live_update", activityKey: key, activityType: activity.activityType, event, contentState: JSON.stringify(contentState), alertTitle: "Election night", alertBody: contentState.subtitle };
    try {
      await broadcastToAndroidEmulator(data);
      log("Android emulator ← live update");
    } catch {
      log("Android emulator not reachable");
    }
  }
}

async function status() {
  const subs = await demoSubscriptions();
  for (const s of subs) {
    const opened = await db.message.count({ where: { pushSubscriptionId: s.id, openedAt: { not: null } } });
    const sent = await db.message.count({ where: { pushSubscriptionId: s.id } });
    log(`${s.platform ?? s.channel}  ${s.contact.externalId ?? `anonymous ${s.contact.anonymousId?.slice(0, 8)}`}  ${sent} sent · ${opened} opened`);
  }
  for (const [slug, name] of NEWSLETTERS) {
    const g = await db.subscriptionGroup.findUnique({ where: { slug } });
    const who = g
      ? await db.subscriptionState.findMany({ where: { groupId: g.id, subscribed: true, contactId: { in: subs.map((s) => s.contactId) } }, include: { contact: true } })
      : [];
    log(`${name}: ${who.map((w) => w.contact.externalId ?? "anonymous").join(", ") || "no demo subscribers"}`);
  }
  const reads = await db.contactEvent.count({ where: { name: "article_read", contactId: { in: subs.map((s) => s.contactId) } } });
  log(`${subs.length} demo device(s), ${reads} article reads`);
}

async function main() {
  const [cmd, ...rest] = args;
  switch (cmd) {
    case "setup": await setup(); break;
    case "breaking": await breaking(rest.filter((a) => !a.startsWith("--"))[0] ?? "Major story breaking now"); break;
    case "foryou": await sendToDemoDevices("forYou"); break;
    case "newsletter": await newsletter(rest[0] ?? "morning-briefing"); break;
    case "inapp": await inApp(); break;
    case "cards": await cards(); break;
    case "live": await live((rest[0] as "start" | "update" | "end") ?? "update"); break;
    case "status": await status(); break;
    default:
      console.log(readFileSync(__filename, "utf8").split("*/")[0]);
  }
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
