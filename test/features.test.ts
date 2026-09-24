import { test } from "node:test";
import assert from "node:assert/strict";
import { localize, normalizeLanguage, pickTranslation } from "../src/lib/localize";
import { toSegmentBatch } from "../src/lib/segmentOutbound";
import { makeEvent } from "../src/lib/webhooks/events";
import { apnsLivePayload, fcmLiveData } from "../src/lib/liveActivities";
import type { LiveActivity } from "@prisma/client";

test("language tags normalise", () => {
  assert.equal(normalizeLanguage("pt_br"), "pt-BR");
  assert.equal(normalizeLanguage("DE"), "de");
  assert.equal(normalizeLanguage("zh-Hant-TW"), "zh-Hant-TW");
  assert.equal(normalizeLanguage("123"), null);
  assert.equal(normalizeLanguage(""), null);
});

test("translation pick: exact, then primary language, else default", () => {
  const tr = { de: { pushTitle: "Eilmeldung" }, "pt-BR": { pushTitle: "Urgente" }, pt: { pushTitle: "Última hora" } };
  assert.equal(pickTranslation(tr, "de-AT"), "de");
  assert.equal(pickTranslation(tr, "pt-BR"), "pt-BR");
  assert.equal(pickTranslation(tr, "pt-PT"), "pt");
  assert.equal(pickTranslation({ "es-MX": {} }, "es"), "es-MX"); // same language, other region
  assert.equal(pickTranslation(tr, "fr"), null);
  assert.equal(pickTranslation(tr, null), null);
});

test("localize overrides only translated, non-blank fields", () => {
  const t = {
    subject: null, htmlBody: null, textBody: null,
    pushTitle: "Breaking", pushBody: "Default body", pushUrl: "myapp://a", pushImageUrl: null,
    translations: { de: { pushTitle: "Eilmeldung", pushBody: "  " } },
  };
  const de = localize(t, "de-DE");
  assert.equal(de.pushTitle, "Eilmeldung");
  assert.equal(de.pushBody, "Default body"); // blank → default
  assert.equal(de.pushUrl, "myapp://a");
  assert.equal(localize(t, "fr"), t);
});

test("Segment outbound: spec event names, userId or anonymous fallback, dedupe ids", () => {
  const events = [
    makeEvent("message.delivered", { messageId: "m1", channel: "FCM", contactId: "c1", externalId: "user-1" }),
    makeEvent("message.opened", { messageId: "m2", channel: "EMAIL", contactId: "c2", externalId: null }),
  ];
  const { batch } = toSegmentBatch(events);
  assert.equal(batch[0].event, "Push Notification Received");
  assert.equal(batch[0].userId, "user-1");
  assert.equal(batch[0].messageId, events[0].id);
  assert.equal(batch[1].event, "Email Opened");
  assert.equal(batch[1].anonymousId, "dispatch:c2");
  assert.equal((batch[1].properties as Record<string, unknown>).messageId, "m2");
});

const activity = {
  id: "la1", key: "election-2026", activityType: "ElectionAttributes",
  attributes: { race: "President" }, contentState: {}, status: "ACTIVE",
} as unknown as LiveActivity;

test("Live Activity APNs payload follows ActivityKit's push format", () => {
  const start = apnsLivePayload(activity, "start", { contentState: { counted: 10 }, alert: { title: "Polls closed", body: "Counting begins" } }).aps as Record<string, unknown>;
  assert.equal(start.event, "start");
  assert.equal(start["attributes-type"], "ElectionAttributes");
  assert.deepEqual(start.attributes, { race: "President" });
  assert.deepEqual(start["content-state"], { counted: 10 });
  assert.ok(typeof start.timestamp === "number");

  const end = apnsLivePayload(activity, "end", { contentState: { counted: 100 }, dismissalDate: "2026-11-04T12:00:00Z" }).aps as Record<string, unknown>;
  assert.equal(end["dismissal-date"], Date.parse("2026-11-04T12:00:00Z") / 1000);
  assert.equal(end.attributes, undefined);
});

test("Android Live Update is a string-only FCM data map", () => {
  const d = fcmLiveData(activity, "update", { contentState: { counted: 55 }, alert: { title: "Update", body: "55%" } });
  assert.ok(Object.values(d).every((v) => typeof v === "string"));
  assert.equal(d.dispatchType, "live_update");
  assert.deepEqual(JSON.parse(d.contentState), { counted: 55 });
});

test("warehouse setup: valid BigQuery params, Redshift columns match JSON keys, Snowflake pipes per type", async () => {
  const { warehouseSetup, EXPORT_COLUMNS } = await import("../src/lib/warehouse");
  const loc = { bucket: "b", prefix: "p", region: "eu-west-1" };
  const bq = warehouseSetup("bigquery", loc);
  for (const line of bq.split("\n").filter((l) => l.includes("--params="))) {
    const params = JSON.parse(line.slice(line.indexOf("'") + 1, line.lastIndexOf("'")));
    assert.match(params.data_path, /^s3:\/\/b\/p\/\w+\/daily-\{run_time-24h\|"%Y-%m-%d"\}\/\*\.ndjson\.gz$/);
  }
  const rs = warehouseSetup("redshift", loc);
  for (const c of EXPORT_COLUMNS.messages) assert.ok(rs.includes(`  ${c.name.toLowerCase()} `), c.name);
  assert.equal((rs.match(/^COPY /gm) ?? []).length, 3);
  const sf = warehouseSetup("snowflake", loc);
  assert.equal((sf.match(/CREATE PIPE/g) ?? []).length, 3);
  assert.ok(sf.includes("$1:contactId::VARCHAR"));
  assert.ok(sf.includes("STORAGE_ALLOWED_LOCATIONS = ('s3://b/p/')"));
});

test("SMS/WhatsApp: phone normalisation, segment counting, Twilio request form, signature", async () => {
  const { normalizePhone, smsSegments, twilioForm, twilioSignature, validTwilioSignature } = await import("../src/lib/channels/sms/twilio");
  assert.equal(normalizePhone("+44 20 7946-0958"), "+442079460958");
  assert.equal(normalizePhone("0044 7700 900123"), "+447700900123");
  assert.equal(normalizePhone("07700 900123"), null, "national format isn't E.164");
  assert.deepEqual(smsSegments("a".repeat(160)), { encoding: "GSM-7", length: 160, segments: 1 });
  assert.equal(smsSegments("a".repeat(161)).segments, 2);
  assert.equal(smsSegments("€".repeat(80)).segments, 1, "€ counts double in GSM-7");
  assert.equal(smsSegments("Breaking 🔥".padEnd(71, ".")).encoding, "UCS-2");
  assert.equal(smsSegments("Breaking 🔥".padEnd(71, ".")).segments, 2);

  const cfg = { accountSid: "AC" + "0".repeat(32), authToken: "t", messagingServiceSid: "MG" + "1".repeat(32), whatsappFrom: "+14155238886" };
  const sms = twilioForm(cfg, { messageId: "m", channel: "SMS", to: "+44 7700 900123", smsBody: "Hi" }) as URLSearchParams;
  assert.equal(sms.get("To"), "+447700900123");
  assert.equal(sms.get("MessagingServiceSid"), cfg.messagingServiceSid);
  assert.ok(sms.get("StatusCallback")!.endsWith("/api/webhooks/twilio"));
  const wa = twilioForm(cfg, { messageId: "m", channel: "WHATSAPP", to: "+447700900123", smsBody: "x", whatsappContentSid: "HX" + "2".repeat(32), whatsappVariables: { "1": "Ana" } }) as URLSearchParams;
  assert.equal(wa.get("To"), "whatsapp:+447700900123");
  assert.equal(wa.get("From"), "whatsapp:+14155238886");
  assert.equal(wa.get("ContentVariables"), '{"1":"Ana"}');
  assert.equal(wa.get("Body"), null, "templates replace the free-text body");
  assert.deepEqual(twilioForm(cfg, { messageId: "m", channel: "SMS", to: "12", smsBody: "x" }), { error: "no valid phone number (E.164)" });

  const params = { MessageSid: "SM1", MessageStatus: "delivered" };
  const sig = twilioSignature("secret", "https://x.test/api/webhooks/twilio", params);
  assert.ok(validTwilioSignature("secret", "https://x.test/api/webhooks/twilio", params, sig));
  assert.ok(!validTwilioSignature("secret", "https://x.test/api/webhooks/twilio", { ...params, MessageStatus: "read" }, sig));
  assert.ok(!validTwilioSignature("other", "https://x.test/api/webhooks/twilio", params, sig));
});
