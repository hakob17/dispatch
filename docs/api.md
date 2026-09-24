# Dispatch API reference

Two APIs, both JSON over HTTPS:

| API | Prefix | Key | Used by |
| --- | --- | --- | --- |
| Server | `/api/v1/*` | server key `dk_…` | your backend, CDP, data jobs |
| Client SDK | `/api/sdk/v1/*` (CORS on) | SDK key `dk_pub_…` | iOS, Android, React / React Native SDKs, browsers |

Send the key as `Authorization: Bearer <key>`. Create and revoke keys under **Settings → REST API
keys**; usage per endpoint over the last 30 days is shown there. SDK keys are safe to ship in apps.
They can only reach `/api/sdk/v1`, and with `SDK_REQUIRE_USER_TOKEN=true` every call about a
signed-in user must also carry `X-Dispatch-User-Token` (minted by `POST /api/v1/sdk-tokens`).

## Rate limits (RFP 1.4, 1.5)

Fixed one-minute windows, counted per API key and shared by every server instance (the counters
live in Postgres, so scaling out doesn't multiply the limit).

| Caller | Default per minute | Setting |
| --- | --- | --- |
| Server key | 6,000 requests | `API_RATE_LIMIT_SERVER_PER_MIN` |
| SDK key (all devices together) | 60,000 requests | `API_RATE_LIMIT_SDK_PER_MIN` |
| Unauthenticated (per IP, only when no keys exist yet) | 120 requests | `API_RATE_LIMIT_ANON_PER_MIN` |

These are defaults for a self-hosted deployment; raise them with the environment variables above
(and size the database and web tasks to match). Requests are the unit, not recipients: one
`POST /api/v1/campaigns/trigger` can address 1,000 recipients and one `POST /api/v1/users/track`
can carry 100 attribute updates and 100 events.

Every authenticated response carries:

```
X-RateLimit-Limit: 6000
X-RateLimit-Remaining: 5993
X-RateLimit-Reset: 1790271600        (unix seconds, end of the current window)
```

When the limit is exceeded the API answers **429** and accepts nothing from that request:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 17
X-RateLimit-Limit: 6000
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1790271600

{ "error": "rate_limited",
  "message": "Rate limit of 6000 requests/minute exceeded. Nothing from this request was accepted; retry after 17s." }
```

No message or event is silently dropped. A rejected request had no effect and should be retried
after `Retry-After`. The SDKs do this themselves and keep queued events on disk until they're
accepted. Limits apply at the API edge only: a campaign already accepted is sent at full provider
speed and never throttled by them.

## Errors

| Status | Body | Meaning |
| --- | --- | --- |
| 400 | `{ "error": { "fieldErrors": … } }` | request failed validation (zod) |
| 401 | `{ "error": "API key required (Authorization: Bearer <key>)" }` / `{ "error": "invalid API key" }` | missing, unknown or revoked key |
| 403 | `{ "error": "a SERVER key is required for this endpoint" }` | wrong key scope (an SDK key on `/api/v1`) |
| 401/403 | `{ "error": "valid X-Dispatch-User-Token required for externalId" }` | user token missing or wrong (`SDK_REQUIRE_USER_TOKEN`) |
| 404 | `{ "error": "…" }` | unknown campaign / user / message |
| 429 | see above | rate limited |
| 5xx | `{ "error": "…" }` | retry with backoff; requests are idempotent where noted |

## Server API — `/api/v1`

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| POST | `/campaigns/trigger` | `{ campaignId, recipients?: [{ externalId \| email \| contactId }] }` ≤1,000 | no recipients = broadcast to the campaign audience |
| POST | `/users/track` | `{ attributes: [...≤100], events: [...≤100] }` | bulk profile + event ingest; unknown profiles are created |
| POST | `/users/delete` | `{ externalIds?, emails? }` | erasure (GDPR/CCPA) |
| GET | `/users/export` | `?externalId=` or `?email=` | data subject access request |
| GET | `/subscriptions` | — | newsletters and topics (id, slug, kind) |
| POST | `/subscriptions` | `{ updates: [{ externalId \| email \| anonymousId, groups: { "<id or slug>": bool } }] }` ≤100 | subscribe/unsubscribe from your backend |
| GET | `/recommendations` | `?externalId&strategy=for_you\|trending\|latest&limit&section` | what a reader would be recommended |
| POST | `/content/items` | `{ items: [...] }` | publish/update articles in the content catalog |
| POST | `/live-activities` | `{ key, activityType, attributes, contentState }` | create an iOS Live Activity / Android Live Update |
| POST | `/live-activities/{key}/update` · `/end` | `{ contentState, alert? }` | push an update / end it |
| GET | `/live-activities/{key}` · `/live-activities/{key}/followers` | — | activity state, registered tokens |
| POST | `/sdk-tokens` | `{ externalId }` | user token for `SDK_REQUIRE_USER_TOKEN` |
| GET | `/export/contacts` | — | NDJSON stream: every profile, raw device tokens, subscription states |
| GET | `/export/workspace` | — | JSON: segments, templates, newsletters/topics, campaigns with delivery history, journeys, feeds, webhooks, suppressions |
| POST | `/exports` | `{ type: contacts\|events\|messages\|message_events, since?, until? }` | async, gzip NDJSON parts + manifest to S3 |

## Client SDK API — `/api/sdk/v1`

Every call identifies the reader with `anonymousId` and/or `externalId` (query string for GET,
body otherwise). The SDKs wrap all of these; you don't normally call them directly.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/identify` | create/update the profile; merges the anonymous profile at sign-in |
| POST | `/events` | batch of up to 100 events |
| POST | `/push/register` · `/push/unregister` | device token (FCM / APNs / web push) |
| POST | `/push/received` · `/push/opened` | delivery receipt and open (with action id) |
| GET/PUT | `/preferences` | newsletters and topics with the reader's state; PUT accepts ids or slugs |
| GET | `/inbox` | message centre and pending in-app messages |
| POST | `/inbox/read` · `/inbox/delete` · `/inbox/displayed` · `/inbox/clicked` | message centre actions |
| GET | `/cards` | content-card feed (`?category=`), pinned first |
| POST | `/cards/viewed` · `/cards/clicked` · `/cards/dismissed` | card impressions, taps, dismissals |
| GET | `/recommendations` | for_you / trending / latest |
| POST | `/live-activities/token` · `/live-activities/push-to-start` · `/live-activities/follow` | Live Activity update / push-to-start tokens, Android follow |
| GET | `/config` | public settings (web push VAPID key) |

## Outbound events

Webhook endpoints (Settings → Webhooks) receive signed JSON: `message.sent`, `message.delivered`,
`message.opened`, `message.clicked`, `message.converted`, `message.failed`, `message.bounced`, `contact.unsubscribed`
Header `X-Dispatch-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. Failed deliveries
retry with backoff; endpoints that keep failing are flagged in the console (see
[operations](operations.md)).
