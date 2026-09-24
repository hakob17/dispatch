/**
 * Database-backed tests (identity merge, rate limiter). They need a migrated
 * Postgres in DATABASE_URL and are skipped without one.
 */
import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const enabled = !!process.env.DATABASE_URL;
const suffix = randomUUID().slice(0, 8);

/**
 * Run a campaign's launch partitions here. Each job is claimed first (PENDING → RUNNING, one
 * winner) so a worker running against the same database can't fan a partition out twice;
 * partitions a worker claimed are awaited instead. Returns how many partitions there were.
 */
async function runPartitions(campaignId: string): Promise<number> {
  const { db } = await import("../src/lib/db");
  const { handleLaunchPartition } = await import("../worker/handlers/launchCampaign");
  const where = { type: "LAUNCH_PARTITION" as const, payload: { path: ["campaignId"], equals: campaignId } };
  const parts = await db.job.findMany({ where });
  for (const j of parts) {
    const { count } = await db.job.updateMany({ where: { id: j.id, status: "PENDING" }, data: { status: "RUNNING" } });
    if (count) await handleLaunchPartition(j.payload as never);
  }
  // Our claims have no lockedAt; a worker's do. Wait for any the worker took.
  for (let i = 0; i < 100; i++) {
    const busy = await db.job.count({ where: { ...where, OR: [{ status: "PENDING" }, { status: "RUNNING", lockedAt: { not: null } }] } });
    if (!busy) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await db.job.deleteMany({ where });
  return parts.length;
}

test("anonymous profile merges into the known user on identify", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { resolveContact } = await import("../src/lib/identity");
  const anonId = `anon-${suffix}-device`;
  const ext = `user-${suffix}`;

  const anon = (await resolveContact({ anonymousId: anonId }, { attributes: { lang: "en" } }))!;
  await db.pushSubscription.create({ data: { contactId: anon.id, channel: "FCM", endpoint: `tok-${suffix}` } });
  await db.contactEvent.create({ data: { contactId: anon.id, name: "article_read" } });
  const known = (await resolveContact({ externalId: ext }, { firstName: "Ana", attributes: { tier: "pro" } }))!;
  assert.notEqual(anon.id, known.id);

  const merged = (await resolveContact({ anonymousId: anonId, externalId: ext }))!;
  assert.equal(merged.id, known.id);
  assert.equal(await db.contact.count({ where: { id: anon.id } }), 0);
  assert.equal(await db.pushSubscription.count({ where: { contactId: known.id } }), 1);
  assert.equal(await db.contactEvent.count({ where: { contactId: known.id } }), 1);
  assert.deepEqual(merged.attributes, { lang: "en", tier: "pro" });

  await db.contact.delete({ where: { id: known.id } });
});

test("an anonymous profile is promoted when no known user exists", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { resolveContact } = await import("../src/lib/identity");
  const anon = (await resolveContact({ anonymousId: `anon-${suffix}-promote` }))!;
  const promoted = (await resolveContact({ anonymousId: `anon-${suffix}-promote`, externalId: `promo-${suffix}` }))!;
  assert.equal(promoted.id, anon.id);
  assert.equal(promoted.externalId, `promo-${suffix}`);
  await db.contact.delete({ where: { id: anon.id } });
});

test("rate limiter counts per key and window, shared through Postgres", { skip: !enabled }, async () => {
  const { hitRateLimit } = await import("../src/lib/rateLimit");
  const key = `test:${suffix}`;
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await hitRateLimit(key, 3));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false]);
  assert.equal(results[3].remaining, 0);
  assert.ok(results[0].resetAt.getTime() > Date.now());
});

after(async () => {
  if (!enabled) return;
  const { db } = await import("../src/lib/db");
  await db.rateLimitBucket.deleteMany({ where: { key: `test:${suffix}` } });
  await db.$disconnect();
});

test("campaign fan-out reaches every contact across pages (keyset paging regression)", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { handleLaunchCampaign } = await import("../worker/handlers/launchCampaign");
  const tag = `fanout-${suffix}`;
  const N = 35;
  for (let i = 0; i < N; i++) {
    await db.contact.create({
      data: {
        externalId: `${tag}-${i}`,
        attributes: { t: tag },
        subscriptions: { create: { channel: "FCM", endpoint: `${tag}-tok-${i}` } },
      },
    });
  }
  const template = await db.messageTemplate.create({ data: { name: tag, channel: "FCM", pushTitle: "t", pushBody: "b" } });
  const segment = await db.segment.create({ data: { name: tag, filters: [{ field: "attributes.t", op: "eq", value: tag }] } });
  const campaign = await db.campaign.create({
    data: { name: tag, channel: "FCM", segmentId: segment.id, variants: { create: [{ templateId: template.id, weight: 100 }] } },
  });

  process.env.LAUNCH_PAGE_SIZE = "10"; // several pages per partition
  process.env.LAUNCH_PARTITIONS = "3";
  try {
    await handleLaunchCampaign({ campaignId: campaign.id });
    assert.equal(await runPartitions(campaign.id), 3);
  } finally {
    delete process.env.LAUNCH_PAGE_SIZE;
    delete process.env.LAUNCH_PARTITIONS;
  }
  const messages = await db.message.count({ where: { campaignId: campaign.id } });
  assert.equal(messages, N);

  await db.job.deleteMany({ where: { type: "SEND_BATCH", payload: { path: ["messageIds"], array_contains: [] } , createdAt: { gte: campaign.createdAt } } }).catch(() => {});
  await db.message.deleteMany({ where: { campaignId: campaign.id } });
  await db.campaign.delete({ where: { id: campaign.id } });
  await db.segment.delete({ where: { id: segment.id } });
  await db.messageTemplate.delete({ where: { id: template.id } });
  await db.contact.deleteMany({ where: { externalId: { startsWith: tag } } });
});

test("newsletter campaign on all push platforms reaches only subscribers, on every device", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { handleLaunchCampaign } = await import("../worker/handlers/launchCampaign");
  const { preferencesFor, setSubscriptions } = await import("../src/lib/subscriptions");
  const { renderMessage } = await import("../src/lib/channels/render");
  const tag = `news-${suffix}`;
  const letter = await db.subscriptionGroup.create({ data: { name: `${tag} briefing`, slug: `${tag}-briefing`, optIn: true } });
  const topic = await db.subscriptionGroup.create({ data: { name: `${tag} sport` } });
  const mk = (id: string, subs: { channel: "FCM" | "APNS" | "WEB_PUSH"; platform: string }[]) =>
    db.contact.create({
      data: {
        externalId: `${tag}-${id}`,
        subscriptions: { create: subs.map((s, i) => ({ ...s, endpoint: `${tag}-${id}-${i}` })) },
      },
    });
  const a = await mk("a", [{ channel: "FCM", platform: "android" }, { channel: "APNS", platform: "ios" }]);
  const b = await mk("b", [{ channel: "FCM", platform: "android" }]); // never subscribed
  const c = await mk("c", [{ channel: "APNS", platform: "ios" }]); // subscribed, then left
  const d = await mk("d", [{ channel: "WEB_PUSH", platform: "web" }]);
  assert.deepEqual(await setSubscriptions(a.id, { [`${tag}-briefing`]: true }), []); // by slug
  await setSubscriptions(c.id, { [letter.id]: true });
  await setSubscriptions(c.id, { [letter.id]: false });
  await setSubscriptions(d.id, { [letter.id]: true, nope: true });

  // Defaults: newsletters off, topics on
  const prefs = await preferencesFor(b.id);
  assert.equal(prefs.find((g) => g.id === letter.id)?.subscribed, false);
  assert.equal(prefs.find((g) => g.id === letter.id)?.kind, "newsletter");
  assert.equal(prefs.find((g) => g.id === topic.id)?.subscribed, true);

  const template = await db.messageTemplate.create({ data: { name: tag, channel: "FCM", pushTitle: "Briefing", pushBody: "b" } });
  const campaign = await db.campaign.create({
    data: {
      name: tag, channel: "FCM", allPushPlatforms: true, subscriptionGroup: { connect: { id: letter.id } },
      segment: { create: { name: tag, filters: [{ field: "externalId", op: "contains", value: tag }] } },
      variants: { create: [{ templateId: template.id, weight: 100 }] },
    },
  });
  process.env.LAUNCH_PARTITIONS = "1";
  try {
    await handleLaunchCampaign({ campaignId: campaign.id });
    await runPartitions(campaign.id);
  } finally {
    delete process.env.LAUNCH_PARTITIONS;
  }
  const msgs = await db.message.findMany({ where: { campaignId: campaign.id }, include: { contact: true } });
  assert.deepEqual(
    msgs.map((m) => `${m.contact.externalId!.slice(-1)}:${m.channel}`).sort(),
    ["a:APNS", "a:FCM", "d:WEB_PUSH"]
  );

  // One FCM template renders for the APNs device as APNs
  const r = await renderMessage({ template, contact: a, messageId: "x", channel: "APNS" });
  assert.equal(r.channel, "APNS");

  await db.message.deleteMany({ where: { campaignId: campaign.id } });
  await db.campaign.delete({ where: { id: campaign.id } });
  await db.segment.deleteMany({ where: { name: tag } });
  await db.messageTemplate.delete({ where: { id: template.id } });
  await db.contact.deleteMany({ where: { externalId: { startsWith: tag } } });
  await db.subscriptionGroup.deleteMany({ where: { id: { in: [letter.id, topic.id] } } });
});

test("a device receipt that beats the worker's SENT write still marks the message delivered", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { recordEngagement } = await import("../src/lib/tracking/record");
  const contact = await db.contact.create({ data: { externalId: `race-${suffix}` } });
  const msg = await db.message.create({ data: { contactId: contact.id, channel: "FCM", status: "SENDING" } });
  assert.equal(await recordEngagement(msg.id, "DELIVERY", { source: "sdk" }), true);
  const after = await db.message.findUniqueOrThrow({ where: { id: msg.id } });
  assert.equal(after.status, "DELIVERED");
  assert.ok(after.deliveredAt);
  await db.contact.delete({ where: { id: contact.id } });
});

test("integration alerts: open once, bump, escalate, auto-disable a dead webhook, resolve on success", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { webhookFailed, providerBatchOutcome, resolveAlert, WEBHOOK_ALERT_AFTER, WEBHOOK_DISABLE_AFTER } = await import("../src/lib/alerts");
  const ep = await db.webhookEndpoint.create({ data: { name: `alert-${suffix}`, url: "https://example.invalid/hook", secret: "s" } });
  const key = `webhook:${ep.id}`;

  await webhookFailed(ep, WEBHOOK_ALERT_AFTER - 1, "HTTP 500");
  assert.equal(await db.systemAlert.count({ where: { key } }), 0, "below the threshold: no alert");
  await webhookFailed(ep, WEBHOOK_ALERT_AFTER, "HTTP 500");
  await webhookFailed(ep, WEBHOOK_ALERT_AFTER + 1, "HTTP 502");
  let open = await db.systemAlert.findMany({ where: { key, resolvedAt: null } });
  assert.equal(open.length, 1, "repeats bump one open alert");
  assert.equal(open[0].count, 2);
  assert.equal(open[0].severity, "WARNING");

  await webhookFailed(ep, WEBHOOK_DISABLE_AFTER, "HTTP 502");
  open = await db.systemAlert.findMany({ where: { key, resolvedAt: null } });
  assert.equal(open[0].severity, "CRITICAL");
  assert.equal((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } })).isActive, false);

  await resolveAlert(key);
  assert.equal(await db.systemAlert.count({ where: { key, resolvedAt: null } }), 0);

  const pkey = `provider:TEST-${suffix}`;
  await providerBatchOutcome(`TEST-${suffix}`, 90, 3, "x"); // a few failures: fine
  assert.equal(await db.systemAlert.count({ where: { key: pkey } }), 0);
  await providerBatchOutcome(`TEST-${suffix}`, 0, 40, "401 invalid credentials");
  assert.equal((await db.systemAlert.findFirstOrThrow({ where: { key: pkey, resolvedAt: null } })).severity, "CRITICAL");
  await providerBatchOutcome(`TEST-${suffix}`, 100, 0);
  assert.equal(await db.systemAlert.count({ where: { key: pkey, resolvedAt: null } }), 0, "success resolves it");

  await db.systemAlert.deleteMany({ where: { key: { in: [key, pkey] } } });
  await db.webhookEndpoint.delete({ where: { id: ep.id } });
});

test("content cards: sent through the worker, listed pinned-first, viewed, clicked, dismissed", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { generateApiKey } = await import("../src/lib/apiAuth");
  const { fanOut } = await import("../src/lib/campaignFanOut");
  const { handleSendBatch } = await import("../worker/handlers/sendMessage");
  const { NextRequest } = await import("next/server");
  const cards = await import("../src/app/api/sdk/v1/cards/route");
  const viewed = await import("../src/app/api/sdk/v1/cards/viewed/route");
  const clicked = await import("../src/app/api/sdk/v1/cards/clicked/route");
  const dismissed = await import("../src/app/api/sdk/v1/cards/dismissed/route");
  const tag = `cards-${suffix}`;
  const key = generateApiKey("SDK");
  const apiKey = await db.apiKey.create({ data: { name: tag, prefix: key.prefix, keyHash: key.keyHash, scope: "SDK" } });
  const contact = await db.contact.create({ data: { externalId: tag, firstName: "Ana" } });

  const mk = async (name: string, extra: Record<string, unknown>) => {
    const template = await db.messageTemplate.create({
      data: { name: `${tag}-${name}`, channel: "CONTENT_CARD", pushTitle: `${name} for {{firstName}}`, pushBody: "b", pushUrl: `app://${name}`, ...extra },
    });
    const campaign = await db.campaign.create({
      data: { name: `${tag}-${name}`, channel: "CONTENT_CARD", variants: { create: [{ templateId: template.id, weight: 100 }] } },
      include: { variants: true },
    });
    await fanOut(campaign, [{ id: contact.id, email: null }], new Set());
    const ids = (await db.message.findMany({ where: { campaignId: campaign.id }, select: { id: true } })).map((m) => m.id);
    await db.job.deleteMany({ where: { type: "SEND_BATCH", payload: { path: ["messageIds"], array_contains: ids } } });
    await handleSendBatch({ messageIds: ids });
    return ids[0];
  };
  const offer = await mk("offer", { cardCategory: "offers" });
  const pinned = await mk("live", { cardPinned: true, cardStyle: "CAPTIONED_IMAGE", cardDismissible: false, inAppButtons: [{ label: "Follow", url: "" }] });

  const req = (path: string, method: "GET" | "POST", body?: object) =>
    new NextRequest(`http://test${path}${method === "GET" ? `?externalId=${tag}` : ""}`, {
      method,
      headers: { Authorization: `Bearer ${key.raw}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify({ externalId: tag, ...body }) : undefined,
    });
  let res = await (await cards.GET(req("/api/sdk/v1/cards", "GET"))).json();
  assert.deepEqual(res.cards.map((c: { id: string }) => c.id), [pinned, offer], "pinned first");
  assert.equal(res.cards[0].title, "live for Ana");
  assert.equal(res.cards[0].style, "CAPTIONED_IMAGE");
  assert.equal(res.cards[0].buttonLabel, "Follow");
  assert.equal(res.unviewed, 2);
  const offersOnly = await (await cards.GET(new NextRequest(`http://test/api/sdk/v1/cards?externalId=${tag}&category=offers`, { headers: { Authorization: `Bearer ${key.raw}` } }))).json();
  assert.deepEqual(offersOnly.cards.map((c: { id: string }) => c.id), [offer]);

  await viewed.POST(req("/api/sdk/v1/cards/viewed", "POST", { messageIds: [offer, pinned] }));
  await clicked.POST(req("/api/sdk/v1/cards/clicked", "POST", { messageIds: [offer], url: "app://offer" }));
  const m = await db.message.findUniqueOrThrow({ where: { id: offer } });
  assert.ok(m.openedAt && m.clickedAt);
  assert.equal(m.status, "DELIVERED");

  const d = await (await dismissed.POST(req("/api/sdk/v1/cards/dismissed", "POST", { messageIds: [offer, pinned] }))).json();
  assert.equal(d.updated, 1, "the non-dismissible card stays");
  res = await (await cards.GET(req("/api/sdk/v1/cards", "GET"))).json();
  assert.deepEqual(res.cards.map((c: { id: string }) => c.id), [pinned]);
  assert.equal(res.unviewed, 0);

  await db.message.deleteMany({ where: { contactId: contact.id } });
  await db.campaign.deleteMany({ where: { name: { startsWith: tag } } });
  await db.messageTemplate.deleteMany({ where: { name: { startsWith: tag } } });
  await db.contact.delete({ where: { id: contact.id } });
  await db.apiKey.delete({ where: { id: apiKey.id } });
});

test("branching journey: wait-for-event, condition, A/B split, timeout, exit event, event entry", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { nodesToSteps, validateGraph } = await import("../src/lib/journeys");
  const { handleEnrollJourney, handleJourneyStep } = await import("../worker/handlers/journeys");
  const { ingestEvents } = await import("../src/lib/events");
  const tag = `jrny-${suffix}`;
  const tpl = await db.messageTemplate.create({ data: { name: tag, channel: "IN_APP", pushTitle: "t", pushBody: "b" } });
  const seg = await db.segment.create({ data: { name: tag, filters: [{ field: "externalId", op: "contains", value: tag }] } });
  const mk = (id: string, tier: string) => db.contact.create({ data: { externalId: `${tag}-${id}`, attributes: { tier } } });
  const [a, b, c, d] = [await mk("a", "pro"), await mk("b", "free"), await mk("c", "pro"), await mk("d", "pro")];

  const nodes = [
    { key: "welcome", type: "MESSAGE", channel: "IN_APP", templateId: tpl.id, next: { default: "wait" } },
    { key: "wait", type: "WAIT_EVENT", config: { event: `${tag}-read`, timeoutMinutes: 60 }, next: { event: "isPro", timeout: "nudge" } },
    { key: "isPro", type: "CONDITION", config: { match: "all", rules: [{ type: "attribute", field: "attributes.tier", op: "eq", value: "pro" }] }, next: { yes: "ab", no: "bye" } },
    { key: "ab", type: "RANDOM", config: { weights: [50, 50] }, next: { branches: ["offerA", "offerB"] } },
    { key: "offerA", type: "MESSAGE", channel: "IN_APP", templateId: tpl.id, next: {} },
    { key: "offerB", type: "MESSAGE", channel: "IN_APP", templateId: tpl.id, next: {} },
    { key: "nudge", type: "MESSAGE", channel: "IN_APP", templateId: tpl.id, next: {} },
    { key: "bye", type: "EXIT", next: {} },
  ] as never[];
  assert.deepEqual(validateGraph(nodes, "welcome"), []);
  assert.match(validateGraph([...nodes, { key: "x", type: "DELAY", config: { minutes: 5 }, next: { default: "nowhere" } }] as never[], "welcome")[0], /missing node "nowhere"/);

  const journey = await db.journey.create({
    data: { name: tag, status: "ACTIVE", segmentId: seg.id, entryKey: "welcome", exitEvent: `${tag}-quit`, steps: { createMany: { data: nodesToSteps(nodes) } } },
  });

  // Run this journey's queued steps here (claiming each job, so a live worker can't run it too)
  const where = { type: "JOURNEY_STEP" as const, payload: { path: ["journeyId"], equals: journey.id } };
  const drain = async (includeFuture = false) => {
    for (let round = 0; round < 50; round++) {
      const jobs = await db.job.findMany({ where: { ...where, status: "PENDING", ...(includeFuture ? {} : { runAt: { lte: new Date(Date.now() + 1000) } }) } });
      if (!jobs.length) {
        // jobs a live worker claimed (lockedAt set) — wait for them to finish
        if (!(await db.job.count({ where: { ...where, status: "RUNNING", lockedAt: { not: null } } }))) return;
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      for (const j of jobs) {
        const { count } = await db.job.updateMany({ where: { id: j.id, status: "PENDING" }, data: { status: "RUNNING" } });
        if (!count) continue; // a live worker took it; the wait above covers it
        await handleJourneyStep(j.payload as never);
        await db.job.update({ where: { id: j.id }, data: { status: "DONE" } });
      }
    }
  };
  await handleEnrollJourney({ journeyId: journey.id });
  await drain();
  const runs = () => db.journeyRun.findMany({ where: { journeyId: journey.id }, include: { contact: true } });
  {
    const rs = await runs();
    assert.ok(rs.every((r) => r.waitingEvent === `${tag}-read`), `everyone got the welcome and waits: ${JSON.stringify(rs.map((r) => [r.currentKey, r.waitingEvent, r.completedAt, r.exitReason]))} jobs: ${JSON.stringify((await db.job.findMany({ where })).map((j) => [j.status, j.lockedAt, (j.payload as { key?: string }).key, j.lastError]))}`);
  }

  // A duplicate of an already-processed step must not send again
  await handleJourneyStep({ journeyId: journey.id, contactId: a.id, key: "welcome" });

  await ingestEvents(a.id, [{ name: `${tag}-read` }]); // pro → A/B offer
  await ingestEvents(b.id, [{ name: `${tag}-read` }]); // free → exit
  await ingestEvents(d.id, [{ name: `${tag}-quit` }]); // exit event
  await drain();
  // c never reads: run its timeout now
  await drain(true);

  const byContact = new Map((await runs()).map((r) => [r.contactId, r]));
  assert.equal(byContact.get(a.id)!.exitReason, "completed");
  assert.equal(byContact.get(b.id)!.exitReason, "exit_node");
  assert.equal(byContact.get(c.id)!.exitReason, "completed");
  assert.equal(byContact.get(d.id)!.exitReason, "exit_event");

  const steps = await db.journeyStep.findMany({ where: { journeyId: journey.id } });
  const sent = async (key: string, contactId: string) =>
    db.message.count({ where: { contactId, journeyStepId: steps.find((s) => s.key === key)!.id } });
  assert.equal(await sent("welcome", a.id), 1, "welcome sent once despite the duplicate job");
  assert.equal((await sent("offerA", a.id)) + (await sent("offerB", a.id)), 1, "exactly one A/B branch");
  assert.equal((await sent("offerA", b.id)) + (await sent("offerB", b.id)), 0);
  assert.equal(await sent("nudge", c.id), 1, "timeout branch");
  assert.equal(await sent("nudge", d.id), 0, "exited before the timeout");

  const visits = await db.journeyVisit.groupBy({ by: ["nodeKey", "branch"], where: { journeyId: journey.id }, _count: { _all: true } });
  const v = (k: string, br: string | null) => visits.find((x) => x.nodeKey === k && x.branch === br)?._count._all ?? 0;
  assert.equal(v("welcome", null), 4);
  assert.equal(v("wait", "event"), 2);
  assert.equal(v("wait", "timeout"), 1);
  assert.equal(v("isPro", "yes"), 1);
  assert.equal(v("isPro", "no"), 1);

  // Event-triggered entry: enrols on the event, once
  const trig = await db.journey.create({
    data: { name: `${tag}-trig`, status: "ACTIVE", triggerEvent: `${tag}-signup`, entryKey: "hi", steps: { createMany: { data: nodesToSteps([{ key: "hi", type: "MESSAGE", channel: "IN_APP", templateId: tpl.id, next: {} }] as never[]) } } },
  });
  await ingestEvents(a.id, [{ name: `${tag}-signup` }, { name: `${tag}-signup` }]);
  assert.equal(await db.journeyRun.count({ where: { journeyId: trig.id } }), 1);
  await db.job.deleteMany({ where: { type: "JOURNEY_STEP", payload: { path: ["journeyId"], equals: trig.id } } });

  await db.job.deleteMany({ where });
  await db.message.deleteMany({ where: { contactId: { in: [a.id, b.id, c.id, d.id] } } });
  await db.journey.deleteMany({ where: { id: { in: [journey.id, trig.id] } } });
  await db.contact.deleteMany({ where: { externalId: { startsWith: tag } } });
  await db.segment.delete({ where: { id: seg.id } });
  await db.messageTemplate.delete({ where: { id: tpl.id } });
});

test("send-time optimisation: each reader's batch is scheduled at their usual hour", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { bestHours, nextAtHour, populationBestHour } = await import("../src/lib/sendTime");
  const { fanOut } = await import("../src/lib/campaignFanOut");
  const tag = `sto-${suffix}`;
  const hour = (new Date().getUTCHours() + 5) % 24; // a few hours ahead, so the job is in the future
  const at = (daysAgo: number, h: number) => { const d = new Date(Date.now() - daysAgo * 86400_000); d.setUTCHours(h, 20, 0, 0); return d; };
  const early = await db.contact.create({ data: { externalId: `${tag}-early` } });
  const fresh = await db.contact.create({ data: { externalId: `${tag}-fresh` } });
  // Mostly opens at `hour`, one event at another hour
  for (const d of [1, 2, 3]) await db.message.create({ data: { contactId: early.id, channel: "FCM", status: "DELIVERED", openedAt: at(d, hour) } });
  await db.contactEvent.create({ data: { contactId: early.id, name: "app_open", createdAt: at(1, (hour + 3) % 24) } });

  const hours = await bestHours([early.id, fresh.id]);
  assert.equal(hours.get(early.id), hour);
  assert.equal(hours.has(fresh.id), false, "no history, no personal hour");

  const now = new Date(Date.UTC(2026, 8, 24, 10, 30));
  assert.equal(nextAtHour(10, now).getTime(), now.getTime(), "already in the hour: send now");
  assert.equal(nextAtHour(12, now).toISOString(), "2026-09-24T12:00:00.000Z");
  assert.equal(nextAtHour(7, now).toISOString(), "2026-09-25T07:00:00.000Z");

  const tpl = await db.messageTemplate.create({ data: { name: tag, channel: "IN_APP", pushTitle: "t", pushBody: "b" } });
  const campaign = await db.campaign.create({
    data: { name: tag, channel: "IN_APP", sendTimeOptimization: true, variants: { create: [{ templateId: tpl.id, weight: 100 }] } },
    include: { variants: true },
  });
  const before = new Date();
  await fanOut(campaign, [{ id: early.id, email: null }, { id: fresh.id, email: null }], new Set());
  const msgs = await db.message.findMany({ where: { campaignId: campaign.id }, select: { id: true, contactId: true } });
  const jobs = await db.job.findMany({ where: { type: "SEND_BATCH", createdAt: { gte: before } } });
  const jobFor = (messageId: string) => jobs.find((j) => (j.payload as { messageIds: string[] }).messageIds.includes(messageId))!;
  const earlyJob = jobFor(msgs.find((m) => m.contactId === early.id)!.id);
  assert.equal(earlyJob.runAt.getUTCHours(), hour);
  assert.ok(earlyJob.runAt.getTime() - Date.now() <= 24 * 3600_000);
  const pop = await populationBestHour();
  const freshJob = jobFor(msgs.find((m) => m.contactId === fresh.id)!.id);
  if (pop !== null && pop !== new Date().getUTCHours()) assert.equal(freshJob.runAt.getUTCHours(), pop, "falls back to the audience's best hour");

  await db.job.deleteMany({ where: { id: { in: [earlyJob.id, freshJob.id] } } });
  await db.message.deleteMany({ where: { contactId: { in: [early.id, fresh.id] } } });
  await db.campaign.delete({ where: { id: campaign.id } });
  await db.messageTemplate.delete({ where: { id: tpl.id } });
  await db.contact.deleteMany({ where: { externalId: { startsWith: tag } } });
});

test("SAML: signed Ping-style assertion signs in; replay, tampering, wrong cert/audience rejected", { skip: !enabled }, async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { SignedXml } = await import("xml-crypto");
  const { db } = await import("../src/lib/db");
  const { samlClient, identityFromProfile, spEntityId, acsUrl, DEFAULT_ATTRIBUTES } = await import("../src/lib/saml");
  const { provisionSsoUser } = await import("../src/lib/sso");

  const dir = mkdtempSync(join(tmpdir(), "saml-"));
  const mkCert = (name: string) => {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${name}`, "-days", "1", "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.crt`)], { stdio: "ignore" });
    return { key: readFileSync(join(dir, `${name}.key`), "utf8"), cert: readFileSync(join(dir, `${name}.crt`), "utf8") };
  };
  const idp = mkCert("idp");
  const rogue = mkCert("rogue");

  const cfg = {
    entryPoint: "https://idp.example/idp/SSO.saml2", idpCert: idp.cert, idpIssuer: "https://idp.example/ping",
    emailAttributes: DEFAULT_ATTRIBUTES.email, groupsAttributes: DEFAULT_ATTRIBUTES.groups, nameAttributes: DEFAULT_ATTRIBUTES.name,
    allowedDomains: [], autoProvision: true, defaultRole: "USER" as const, adminGroups: ["dispatch-admins"], buttonLabel: "Sign in with Ping",
  };
  const pending = new Map<string, string>();
  const cache = {
    saveAsync: async (k: string, v: string) => (pending.set(k, v), { value: v, createdAt: Date.now() }),
    getAsync: async (k: string) => pending.get(k) ?? null,
    removeAsync: async (k: string | null) => { const v = k ? pending.get(k) ?? null : null; if (k) pending.delete(k); return v; },
  };
  const tag = `saml-${suffix}`;
  const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
  const response = (reqId: string, { signer = idp, audience = spEntityId(), email = `J.Doe.${tag}@Reuters.example` } = {}) => {
    const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${Date.now()}" Version="2.0" IssueInstant="${iso(0)}" Destination="${acsUrl()}" InResponseTo="${reqId}">`
      + `<saml:Issuer>https://idp.example/ping</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`
      + `<saml:Assertion ID="_a${Math.random().toString(36).slice(2)}" Version="2.0" IssueInstant="${iso(0)}"><saml:Issuer>https://idp.example/ping</saml:Issuer>`
      + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">jdoe-${tag}</saml:NameID>`
      + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${reqId}" NotOnOrAfter="${iso(300_000)}" Recipient="${acsUrl()}"/></saml:SubjectConfirmation></saml:Subject>`
      + `<saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
      + `<saml:AuthnStatement AuthnInstant="${iso(0)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
      + `<saml:AttributeStatement><saml:Attribute Name="mail"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>`
      + `<saml:Attribute Name="memberOf"><saml:AttributeValue>news</saml:AttributeValue><saml:AttributeValue>dispatch-admins</saml:AttributeValue></saml:Attribute>`
      + `<saml:Attribute Name="displayName"><saml:AttributeValue>Jane Doe</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion></samlp:Response>`;
    const sig = new SignedXml({ privateKey: signer.key, publicCert: signer.cert, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
    sig.addReference({ xpath: "//*[local-name(.)='Assertion']", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" } });
    return sig.getSignedXml();
  };
  const b64 = (x: string) => Buffer.from(x).toString("base64");
  const client = samlClient(cfg, cache);
  const request = async () => {
    await client.getAuthorizeUrlAsync("", undefined, {});
    return [...pending.keys()].at(-1)!;
  };

  // Valid, then replayed
  const id1 = await request();
  const ok = response(id1);
  const { profile } = await client.validatePostResponseAsync({ SAMLResponse: b64(ok) });
  const identity = identityFromProfile(cfg, profile!);
  assert.equal(identity.email, `j.doe.${tag}@reuters.example`);
  assert.deepEqual(identity.groups, ["news", "dispatch-admins"]);
  const user = await provisionSsoUser(cfg, identity);
  assert.equal(user.role, "ADMIN", "memberOf dispatch-admins");
  assert.equal(user.name, "Jane Doe");
  await assert.rejects(client.validatePostResponseAsync({ SAMLResponse: b64(ok) }), "replayed response");

  // Tampered after signing
  const id2 = await request();
  await assert.rejects(client.validatePostResponseAsync({ SAMLResponse: b64(response(id2).replace(`J.Doe.${tag}`, "ceo")) }), "tampered");
  // Signed by someone else
  const id3 = await request();
  await assert.rejects(client.validatePostResponseAsync({ SAMLResponse: b64(response(id3, { signer: rogue })) }), "wrong certificate");
  // For another service provider
  const id4 = await request();
  await assert.rejects(client.validatePostResponseAsync({ SAMLResponse: b64(response(id4, { audience: "https://other.example/sp" })) }), "wrong audience");
  // Unsolicited (no matching request)
  await assert.rejects(client.validatePostResponseAsync({ SAMLResponse: b64(response("_never-asked")) }), "unsolicited");

  // Through the routes: /start stores the request id in the database; /acs signs the user in
  const { setSetting, deleteSetting } = await import("../src/lib/settings");
  const start = await import("../src/app/api/auth/sso/saml/start/route");
  const acs = await import("../src/app/api/auth/sso/saml/acs/route");
  const { NextRequest } = await import("next/server");
  const hadSaml = await db.setting.findUnique({ where: { key: "saml" } });
  await setSetting("saml", { ...cfg, adminGroups: [] });
  try {
    const redirect = await start.GET();
    const authnUrl = new URL(redirect.headers.get("location")!);
    assert.equal(authnUrl.origin + authnUrl.pathname, cfg.entryPoint);
    // The AuthnRequest travels deflated + base64 (redirect binding); its ID is what the IdP answers to
    const { inflateRawSync } = await import("node:zlib");
    const authnXml = inflateRawSync(Buffer.from(authnUrl.searchParams.get("SAMLRequest")!, "base64")).toString();
    const reqId = /\sID="([^"]+)"/.exec(authnXml)![1];
    assert.equal(await db.setting.count({ where: { key: `saml.req.${reqId}` } }), 1, "request id stored in the database");
    const form = new FormData();
    form.set("SAMLResponse", b64(response(reqId)));
    const res = await acs.POST(new NextRequest("http://localhost:3000/api/auth/sso/saml/acs", { method: "POST", body: form }));
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get("location")!).pathname, "/");
    assert.ok(res.cookies.get("dispatch_session")?.value, "session cookie set");
    assert.equal(await db.setting.count({ where: { key: `saml.req.${reqId}` } }), 0, "request id consumed");
  } finally {
    if (hadSaml) await db.setting.update({ where: { key: "saml" }, data: { value: hadSaml.value as object } });
    else await deleteSetting("saml");
  }

  await db.user.delete({ where: { id: user.id } });
});

test("SMS: mock send, signed delivery callback, STOP reply suppresses the next send", { skip: !enabled }, async () => {
  const { db } = await import("../src/lib/db");
  const { handleSendBatch } = await import("../worker/handlers/sendMessage");
  const { twilioSignature } = await import("../src/lib/channels/sms/twilio");
  const route = await import("../src/app/api/webhooks/twilio/route");
  const { NextRequest } = await import("next/server");
  const tag = `sms-${suffix}`;
  const phone = `+4477009${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`;
  const hadTwilio = await db.setting.findUnique({ where: { key: "twilio" } });
  const token = "test-auth-token";
  await db.setting.upsert({ where: { key: "twilio" }, create: { key: "twilio", value: { accountSid: "AC" + "0".repeat(32), authToken: token, fromNumber: "+447700900000" } }, update: { value: { accountSid: "AC" + "0".repeat(32), authToken: token, fromNumber: "+447700900000" } } });
  const prevMode = process.env.PUSH_PROVIDER_MODE;
  process.env.PUSH_PROVIDER_MODE = "mock";
  process.env.MOCK_PUSH_BATCH_LATENCY_MS = "0";
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const post = (params: Record<string, string>, sig?: string) => {
    const body = new URLSearchParams(params);
    return route.POST(new NextRequest(`${base}/api/webhooks/twilio`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "x-twilio-signature": sig ?? twilioSignature(token, `${base}/api/webhooks/twilio`, params) },
      body,
    }));
  };
  try {
    const contact = await db.contact.create({ data: { externalId: tag, firstName: "Ana", phone } });
    const tpl = await db.messageTemplate.create({ data: { name: tag, channel: "SMS", smsBody: "Hi {{firstName}}" } });
    // Messages get their template through a campaign variant
    const campaign = await db.campaign.create({ data: { name: tag, channel: "SMS", variants: { create: [{ templateId: tpl.id, weight: 100 }] } }, include: { variants: true } });
    const mk = () => db.message.create({ data: { contactId: contact.id, campaignId: campaign.id, variantId: campaign.variants[0].id, channel: "SMS", status: "QUEUED" } });

    const first = await mk();
    await handleSendBatch({ messageIds: [first.id] });
    const sent = await db.message.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(sent.status, "SENT");
    assert.ok(sent.providerMessageId);

    assert.equal((await post({ MessageSid: sent.providerMessageId!, MessageStatus: "delivered" }, "forged")).status, 403, "bad signature");
    assert.equal((await post({ MessageSid: sent.providerMessageId!, MessageStatus: "delivered" })).status, 200);
    assert.equal((await db.message.findUniqueOrThrow({ where: { id: first.id } })).status, "DELIVERED");

    await post({ From: phone, To: "+447700900000", Body: " stop " });
    assert.equal(await db.suppression.count({ where: { channel: "SMS", address: phone } }), 1);
    const second = await mk();
    await handleSendBatch({ messageIds: [second.id] });
    const blocked = await db.message.findUniqueOrThrow({ where: { id: second.id } });
    assert.equal(blocked.status, "SUPPRESSED");
    assert.equal(blocked.error, "opted out (STOP)");

    await post({ From: phone, To: "+447700900000", Body: "START" });
    assert.equal(await db.suppression.count({ where: { channel: "SMS", address: phone } }), 0, "START opts back in");

    await db.message.deleteMany({ where: { contactId: contact.id } });
    await db.campaign.delete({ where: { id: campaign.id } });
    await db.messageTemplate.delete({ where: { id: tpl.id } });
    await db.contact.delete({ where: { id: contact.id } });
  } finally {
    if (prevMode === undefined) delete process.env.PUSH_PROVIDER_MODE; else process.env.PUSH_PROVIDER_MODE = prevMode;
    delete process.env.MOCK_PUSH_BATCH_LATENCY_MS;
    if (hadTwilio) await db.setting.update({ where: { key: "twilio" }, data: { value: hadTwilio.value as object } });
    else await db.setting.delete({ where: { key: "twilio" } });
  }
});

test("raw-SQL timestamps round-trip exactly, whatever the DB session timezone", { skip: !enabled }, async () => {
  const { db, utcTs } = await import("../src/lib/db");
  const { Prisma } = await import("@prisma/client");
  const at = new Date("2026-03-29T01:30:00.000Z"); // a DST-change night in Europe
  const [row] = await db.$queryRaw<{ t: Date }[]>(Prisma.sql`SELECT ${utcTs(at)} AS t`);
  assert.equal(new Date(row.t).toISOString(), at.toISOString());
});
