import { test } from "node:test";
import assert from "node:assert/strict";
import { DispatchClient } from "../src/client";
import { extractPush } from "../src/notification";
import { memoryStorage } from "../src/storage";
import type { DispatchError } from "../src/types";

interface Call {
  method: string;
  path: string;
  query: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

/** Scripted fetch: records calls, answers from a per-path queue (default 200 {}). */
function mockFetch(responses: Record<string, { status: number; body?: unknown; headers?: Record<string, string> }[]> = {}) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({
      method: init.method ?? "GET",
      path: u.pathname,
      query: u.search,
      body: init.body ? JSON.parse(String(init.body)) : null,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const r = responses[u.pathname]?.shift() ?? { status: 200, body: { ok: true } };
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { calls, impl, paths: () => calls.map((c) => c.path) };
}

function makeClient(f: ReturnType<typeof mockFetch>, storage = memoryStorage(), errors: DispatchError[] = []) {
  return new DispatchClient({
    apiKey: "dk_pub_test",
    baseUrl: "https://dispatch.test/",
    storage,
    fetch: f.impl,
    flushIntervalMs: 0,
    maxBatchSize: 3,
    onError: (e) => errors.push(e),
  });
}

test("init creates and persists an anonymous id, and registers the anonymous profile", async () => {
  const f = mockFetch();
  const storage = memoryStorage();
  const c = makeClient(f, storage);
  await c.init();
  const anon = c.getAnonymousId();
  assert.ok(anon && anon.length >= 32);
  assert.equal(await storage.getItem("dispatch.anonymousId"), anon);
  assert.deepEqual(f.calls[0], {
    method: "POST",
    path: "/api/sdk/v1/identify",
    query: "",
    body: { anonymousId: anon },
    headers: { Authorization: "Bearer dk_pub_test", "Content-Type": "application/json" },
  });

  // A second client on the same storage keeps the same anonymous user
  const c2 = makeClient(mockFetch(), storage);
  await c2.init();
  assert.equal(c2.getAnonymousId(), anon);
});

test("events are batched by maxBatchSize and flushed", async () => {
  const f = mockFetch();
  const c = makeClient(f);
  await c.init();
  c.track("a");
  c.track("b");
  assert.equal(f.paths().filter((p) => p.endsWith("/events")).length, 0);
  c.track("c", { x: 1 }); // hits maxBatchSize (3)
  await c.flush();
  const sent = f.calls.filter((x) => x.path === "/api/sdk/v1/events");
  assert.equal(sent.length, 1);
  assert.deepEqual((sent[0].body!.events as { name: string }[]).map((e) => e.name), ["a", "b", "c"]);
});

test("retryable failures keep events queued (and honour Retry-After); 4xx drops the batch", async () => {
  const f = mockFetch({
    "/api/sdk/v1/events": [
      { status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "7" } },
      { status: 400, body: { error: "bad" } },
    ],
  });
  const storage = memoryStorage();
  const errors: DispatchError[] = [];
  const c = makeClient(f, storage, errors);
  await c.init();
  c.track("keep-me");
  await c.flush();
  assert.equal(errors[0].status, 429);
  assert.equal(errors[0].retryAfterSeconds, 7);
  assert.match(String(await storage.getItem("dispatch.eventQueue")), /keep-me/);

  // Paused until Retry-After passes: flush is a no-op
  await c.flush();
  assert.equal(f.calls.filter((x) => x.path.endsWith("/events")).length, 1);

  (c as unknown as { pausedUntil: number }).pausedUntil = 0;
  await c.flush(); // 400 → dropped, not retried forever
  assert.equal(errors[1].status, 400);
  assert.equal(await storage.getItem("dispatch.eventQueue"), null);
});

test("queued events survive a restart", async () => {
  const storage = memoryStorage();
  const offline = mockFetch({ "/api/sdk/v1/events": [{ status: 503 }] });
  const c = makeClient(offline, storage);
  await c.init();
  c.track("offline-event");
  await c.flush();

  const online = mockFetch();
  const c2 = makeClient(online, storage);
  await c2.init();
  await c2.flush();
  const sent = online.calls.find((x) => x.path.endsWith("/events"));
  assert.equal((sent!.body!.events as { name: string }[])[0].name, "offline-event");
});

test("identify flushes anonymous events first, then links anonymousId → externalId with the user token", async () => {
  const f = mockFetch();
  const c = makeClient(f);
  await c.init();
  const anon = c.getAnonymousId();
  c.track("before-login");
  await c.identify("user-42", { firstName: "Ana", attributes: { tier: "pro" } }, { userToken: "tok" });

  const events = f.calls.find((x) => x.path.endsWith("/events"))!;
  assert.deepEqual({ anonymousId: events.body!.anonymousId, externalId: events.body!.externalId }, { anonymousId: anon, externalId: undefined });
  const last = f.calls[f.calls.length - 1];
  assert.equal(last.path, "/api/sdk/v1/identify");
  assert.deepEqual(last.body, { anonymousId: anon, externalId: "user-42", firstName: "Ana", attributes: { tier: "pro" } });
  assert.equal(last.headers["X-Dispatch-User-Token"], "tok");
  assert.ok(f.calls.indexOf(events) < f.calls.indexOf(last));
});

test("push token registration, then sign-out moves the token to a fresh anonymous profile", async () => {
  const f = mockFetch();
  const c = new DispatchClient({
    apiKey: "dk_pub_test",
    baseUrl: "https://dispatch.test",
    storage: memoryStorage(),
    fetch: f.impl,
    flushIntervalMs: 0,
    platform: "android",
    deviceId: "dev-1",
    appVersion: "5.2.0",
  });
  await c.identify("user-42");
  await c.registerPushToken("fcm-token-123", "FCM");
  const reg = f.calls.find((x) => x.path.endsWith("/push/register"))!;
  assert.deepEqual(reg.body, {
    anonymousId: c.getAnonymousId(),
    externalId: "user-42",
    channel: "FCM",
    token: "fcm-token-123",
    platform: "android",
    deviceId: "dev-1",
    appVersion: "5.2.0",
  });

  const oldAnon = c.getAnonymousId();
  await c.reset();
  assert.notEqual(c.getAnonymousId(), oldAnon);
  assert.equal(c.getExternalId(), null);
  const reReg = f.calls.filter((x) => x.path.endsWith("/push/register")).pop()!;
  assert.deepEqual({ a: reReg.body!.anonymousId, e: reReg.body!.externalId, t: reReg.body!.token }, { a: c.getAnonymousId(), e: undefined, t: "fcm-token-123" });

  await c.reset({ keepPushToken: false });
  assert.equal(f.calls.pop()!.path, "/api/sdk/v1/push/unregister");
});

test("notificationOpened reports once per message and returns the deep link", async () => {
  const f = mockFetch();
  const c = makeClient(f);
  const remoteMessage = { messageId: "fcm-internal-id", data: { messageId: "m1", url: "myapp://story/9", section: "world" }, notification: { title: "Breaking", body: "News" } };
  const push = await c.notificationOpened(remoteMessage);
  assert.equal(push?.url, "myapp://story/9");
  await c.notificationOpened(remoteMessage); // cold start + listener can both fire
  const opens = f.calls.filter((x) => x.path.endsWith("/push/opened"));
  assert.equal(opens.length, 1);
  assert.deepEqual(opens[0].body, { messageId: "m1" });
  assert.equal(await c.notificationOpened({ data: { foo: "bar" } }), null); // not a Dispatch push
});

test("extractPush understands RN Firebase, APNs userInfo, Notifee and web shapes", () => {
  const fcm = extractPush({ data: { messageId: "m1", url: "https://x.test/a", imageUrl: "https://img" }, notification: { title: "T", body: "B" } });
  assert.deepEqual([fcm?.messageId, fcm?.url, fcm?.imageUrl, fcm?.title], ["m1", "https://x.test/a", "https://img", "T"]);

  const apns = extractPush({ aps: { alert: { title: "Hi", body: "There" }, "mutable-content": 1 }, messageId: "m2", url: "myapp://x" });
  assert.deepEqual([apns?.messageId, apns?.title, apns?.body, apns?.url], ["m2", "Hi", "There", "myapp://x"]);

  const notifee = extractPush({ detail: { notification: { title: "N", data: { messageId: "m3", url: "/" } } } });
  assert.deepEqual([notifee?.messageId, notifee?.url], ["m3", null]); // "/" = no link

  assert.equal(extractPush({ notification: { title: "someone else's" } }), null);
  assert.equal(extractPush(null), null);
});

test("extractPush understands expo-notifications (direct APNs payload on the trigger)", () => {
  const expo = {
    date: 0,
    request: {
      identifier: "x",
      content: { title: "Tech Weekly", body: "Chips rally", data: null },
      trigger: { type: "push", payload: { aps: { alert: { title: "Tech Weekly", body: "Chips rally" } }, messageId: "m9", url: "myapp://a/1" } },
    },
  };
  const p = extractPush(expo)!;
  assert.equal(p.messageId, "m9");
  assert.equal(p.url, "myapp://a/1");
  assert.equal(p.title, "Tech Weekly");
  assert.equal(extractPush(expo.request)!.messageId, "m9");
});

test("preferences round-trip", async () => {
  const groups = [
    { id: "g1", slug: null, name: "Markets", description: null, kind: "topic" as const, subscribed: true },
    { id: "g2", slug: "morning-briefing", name: "Morning Briefing", description: "7am", kind: "newsletter" as const, subscribed: false },
  ];
  const f = mockFetch({
    "/api/sdk/v1/preferences": [
      { status: 200, body: { groups } },
      { status: 200, body: { groups: [{ ...groups[0], subscribed: false }, { ...groups[1], subscribed: true }] } },
    ],
  });
  const c = makeClient(f);
  assert.deepEqual(await c.getPreferences(), groups);
  const updated = await c.setPreferences({ g1: false, "morning-briefing": true }); // ids or slugs
  assert.equal(updated[0].subscribed, false);
  assert.equal(updated[1].kind, "newsletter");
  assert.equal(updated[1].subscribed, true);
  const put = f.calls.find((x) => x.method === "PUT")!;
  assert.deepEqual(put.body!.groups, { g1: false, "morning-briefing": true });
  assert.ok(f.calls.find((x) => x.method === "GET")!.path.startsWith("/api/sdk/v1/preferences"));
});

test("live activities: iOS tokens, Android follow, and Live Update parsing", async () => {
  const { extractLiveUpdate } = await import("../src/notification");
  const f = mockFetch();
  const c = makeClient(f);
  await c.registerLiveActivityToken("election-2026", "a".repeat(64));
  await c.registerPushToStartToken("ElectionAttributes", "b".repeat(64));
  await assert.rejects(c.followLiveActivity("election-2026"), /register an FCM token/);
  await c.registerPushToken("fcm-token-xyz", "FCM");
  await c.followLiveActivity("election-2026");
  const follow = f.calls.find((x) => x.path.endsWith("/live-activities/follow"))!;
  assert.deepEqual({ k: follow.body!.activityKey, t: follow.body!.token, u: follow.body!.unfollow }, { k: "election-2026", t: "fcm-token-xyz", u: false });
  assert.ok(f.paths().includes("/api/sdk/v1/live-activities/token"));
  assert.ok(f.paths().includes("/api/sdk/v1/live-activities/push-to-start"));

  const upd = extractLiveUpdate({
    data: { dispatchType: "live_update", activityKey: "election-2026", activityType: "ElectionAttributes", event: "update", contentState: '{"seatsCounted":412}', alertTitle: "Update", alertBody: "412 seats counted" },
  });
  assert.deepEqual(upd?.contentState, { seatsCounted: 412 });
  assert.equal(upd?.alert?.body, "412 seats counted");
  assert.equal(extractLiveUpdate({ data: { messageId: "m1" } }), null);
});

test("message centre, in-app reporting and recommendations", async () => {
  const f = mockFetch({
    "/api/sdk/v1/inbox": [{ status: 200, body: { unread: 1, messages: [{ id: "m1", layout: "MODAL", title: "Hi", body: "", imageUrl: null, url: null, buttons: [], sentAt: "", expiresAt: null, read: false, display: true }] } }],
    "/api/sdk/v1/recommendations": [{ status: 200, body: { items: [{ id: "a1", title: "Story", url: "https://x/a1" }] } }],
  });
  const c = makeClient(f);
  await c.identify("user-1");
  const inbox = await c.getInbox({ limit: 10 });
  assert.equal(inbox.unread, 1);
  const get = f.calls.find((x) => x.path === "/api/sdk/v1/inbox")!;
  assert.equal(get.method, "GET");
  await c.markRead(["m1"]);
  await c.reportDisplayed("m1");
  await c.reportClicked("m1", "myapp://x");
  await c.deleteMessages(["m1"]);
  const posted = f.calls.filter((x) => x.path.startsWith("/api/sdk/v1/inbox/")).map((x) => [x.path.split("/").pop(), x.body!.messageIds, x.body!.externalId]);
  assert.deepEqual(posted, [["read", ["m1"], "user-1"], ["displayed", ["m1"], "user-1"], ["clicked", ["m1"], "user-1"], ["delete", ["m1"], "user-1"]]);

  const recs = await c.getRecommendations({ strategy: "trending", limit: 3 });
  assert.equal(recs[0].id, "a1");
  c.articleRead("a1", { section: "world" });
  await c.flush();
  const ev = f.calls.find((x) => x.path.endsWith("/events"))!;
  assert.deepEqual((ev.body!.events as { name: string; properties: unknown }[])[0], { name: "article_read", properties: { section: "world", itemId: "a1" }, timestamp: (ev.body!.events as { timestamp: string }[])[0].timestamp });
});

test("content cards: feed by category, impressions, clicks, dismissals", async () => {
  const card = { id: "c1", style: "CLASSIC", title: "T", body: "B", imageUrl: null, url: "myapp://c", buttonLabel: null, pinned: true, dismissible: true, category: "offers", sentAt: "", expiresAt: null, viewed: false, clicked: false };
  const f = mockFetch({ "/api/sdk/v1/cards": [{ status: 200, body: { unviewed: 1, cards: [card] } }] });
  const c = makeClient(f);
  await c.identify("user-1");
  const res = await c.getCards({ category: "offers" });
  assert.equal(res.cards[0].pinned, true);
  const get = f.calls.find((x) => x.path === "/api/sdk/v1/cards")!;
  assert.ok(get.query.includes("category=offers") && get.query.includes("externalId=user-1"));
  await c.logCardsViewed(["c1"]);
  await c.logCardClicked("c1", "myapp://c");
  await c.dismissCards(["c1"]);
  await c.logCardsViewed([]); // no call
  assert.deepEqual(f.calls.filter((x) => x.method === "POST" && x.path.startsWith("/api/sdk/v1/cards/")).map((x) => x.path), [
    "/api/sdk/v1/cards/viewed",
    "/api/sdk/v1/cards/clicked",
    "/api/sdk/v1/cards/dismissed",
  ]);
  assert.equal(f.calls.find((x) => x.path === "/api/sdk/v1/cards/clicked")!.body!.url, "myapp://c");
});
