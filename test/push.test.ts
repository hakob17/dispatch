import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFcmMessage } from "../src/lib/channels/push/fcm";
import { buildApnsPayload } from "../src/lib/channels/push/apns";
import { describePath } from "../src/lib/audit";
import { signBody } from "../src/lib/webhooks/events";
import { isSnsUrl, verifySnsMessage, type SnsMessage } from "../src/lib/snsVerify";
import { createHmac } from "node:crypto";
import type { RenderedMessage } from "../src/lib/channels/types";

const breaking: RenderedMessage = {
  messageId: "m1",
  channel: "FCM",
  pushTitle: "Breaking",
  pushBody: "Something happened",
  pushUrl: "myapp://story/1",
  subscription: { endpoint: "tok-1" },
  push: { priority: "HIGH", collapseKey: "story-1", ttlSeconds: 600, imageUrl: "https://cdn.test/a.jpg", data: { section: "world" } },
};

test("FCM message carries priority, collapse, TTL and image for Android and iOS", () => {
  const m = buildFcmMessage(breaking);
  assert.equal(m.token, "tok-1");
  assert.deepEqual(m.data, { section: "world", url: "myapp://story/1", messageId: "m1", priority: "HIGH", imageUrl: "https://cdn.test/a.jpg", collapseKey: "story-1" });
  assert.equal(m.android?.notification?.channelId, "dispatch_breaking");
  assert.equal(m.android?.priority, "high");
  assert.equal(m.android?.collapseKey, "story-1");
  assert.equal(m.android?.ttl, 600_000);
  assert.equal(m.apns?.headers?.["apns-priority"], "10");
  assert.equal(m.apns?.headers?.["apns-collapse-id"], "story-1");
  const exp = Number(m.apns?.headers?.["apns-expiration"]);
  assert.ok(Math.abs(exp - (Date.now() / 1000 + 600)) < 5);
  assert.equal(m.apns?.payload?.aps?.mutableContent, true);
  assert.equal(m.notification?.imageUrl, "https://cdn.test/a.jpg");
});

test("NORMAL priority maps to battery-friendly delivery; no TTL header without ttlSeconds", () => {
  const m = buildFcmMessage({ ...breaking, push: { priority: "NORMAL" } });
  assert.equal(m.android?.priority, "normal");
  assert.equal(m.android?.notification?.channelId, "dispatch_default");
  assert.equal(m.apns?.headers?.["apns-priority"], "5");
  assert.equal(m.apns?.headers?.["apns-expiration"], undefined);
  assert.equal(m.apns?.payload?.aps?.mutableContent, undefined);
});

test("APNs payload keeps the deep link and messageId at top level for the app", () => {
  const p = buildApnsPayload({ ...breaking, channel: "APNS" }) as { aps: Record<string, unknown>; url: string; messageId: string; section: string };
  assert.deepEqual(p.aps.alert, { title: "Breaking", body: "Something happened" });
  assert.equal(p.aps["mutable-content"], 1);
  assert.equal(p.url, "myapp://story/1");
  assert.equal(p.messageId, "m1");
  assert.equal(p.section, "world");
});

test("audit paths replace ids with :id", () => {
  assert.deepEqual(describePath("/api/campaigns/cmufjl0u6000tomj7hdqtro75/launch"), {
    route: "/api/campaigns/:id/launch",
    entityType: "campaigns",
    entityId: "cmufjl0u6000tomj7hdqtro75",
  });
  assert.deepEqual(describePath("/api/settings/webhooks"), { route: "/api/settings/webhooks", entityType: "settings", entityId: null });
});

test("webhook signature is HMAC-SHA256 over '<t>.<body>'", () => {
  const sig = signBody("whsec_x", '{"events":[]}', 1700000000);
  const expected = createHmac("sha256", "whsec_x").update('1700000000.{"events":[]}').digest("hex");
  assert.equal(sig, `t=1700000000,v1=${expected}`);
});

test("SNS: only amazonaws SNS hosts over https are trusted", () => {
  assert.ok(isSnsUrl("https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem"));
  assert.ok(!isSnsUrl("http://sns.eu-west-1.amazonaws.com/x.pem"));
  assert.ok(!isSnsUrl("https://sns.eu-west-1.amazonaws.com.evil.com/x.pem"));
  assert.ok(!isSnsUrl("https://evil.com/sns.eu-west-1.amazonaws.com"));
});

test("SNS: unsigned, foreign-cert and stale messages are rejected before any fetch", async () => {
  const base: SnsMessage = {
    Type: "Notification",
    MessageId: "1",
    TopicArn: "arn:aws:sns:eu-west-1:1:t",
    Message: "{}",
    Timestamp: new Date().toISOString(),
    Signature: "abc",
    SignatureVersion: "2",
    SigningCertURL: "https://evil.com/cert.pem",
  };
  assert.deepEqual(await verifySnsMessage({ ...base, Signature: "" }), { ok: false, reason: "unsigned" });
  assert.deepEqual(await verifySnsMessage(base), { ok: false, reason: "untrusted cert url" });
  const stale = { ...base, SigningCertURL: "https://sns.eu-west-1.amazonaws.com/c.pem", Timestamp: "2020-01-01T00:00:00Z" };
  assert.deepEqual(await verifySnsMessage(stale), { ok: false, reason: "stale message" });
});
