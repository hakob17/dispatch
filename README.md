# Dispatch — a Braze-style engagement console

Self-hosted customer engagement platform: contacts, segments, multi-channel campaigns
(email / web push / mobile push / webhooks), A/B testing with control groups and lift,
event-triggered + recurring campaigns, journeys, subscription groups with a contact
preference center, frequency capping + quiet hours, event tracking with API keys,
time-series analytics, activity logs, a content calendar, media library, reusable
content blocks, and ⌘K search — with email deliverability treated as a first-class
feature.

Built with Next.js (App Router) + TypeScript, Postgres + Prisma, and a DB-backed job
queue processed by a separate worker process. No Redis required.

## Quick start

```bash
npm install
createdb brazecopy                  # local Postgres
cp .env.example .env                # fill in DATABASE_URL at minimum
npx prisma migrate dev
npx prisma db seed                  # 50 demo contacts, a segment, 2 templates

npm run dev                         # dashboard + API on :3000
npm run worker                      # job queue worker (second terminal)
npm test                            # server tests; npm run test:sdk for the SDK
```

Open http://localhost:3000 and sign in. The seed creates a default admin —
**admin@dispatch.local / admin123!** — change it right away (Settings → Team). On a fresh
DB without seeding, the login page offers a first-run "create admin account" step instead.

## Accounts & roles

Login uses DB-backed accounts (scrypt-hashed passwords, signed session cookie).

- **Single sign-on (OIDC).** Okta, Microsoft Entra ID, Google Workspace or any OpenID Connect
  provider (Settings → Single sign-on, or `OIDC_*` env vars). It uses the authorization-code
  flow with PKCE. Accounts can be restricted to allowed email domains and created on first
  sign-in, and admin rights can come from the IdP's `groups` claim, checked at every sign-in.
- **Two-step verification (TOTP).** Works with any authenticator app. Users get 10 one-time
  recovery codes, and secrets are AES-GCM encrypted (`MFA_ENCRYPTION_KEY`). Users manage it
  on the Account page; admins can reset it for someone who lost their phone.
- **Sign-in policy.** "Require two-step verification" makes users enrol at their next
  sign-in. "Only allow single sign-on" turns off passwords for everyone except admins, who
  keep them (with 2FA) as break-glass access.
- **Audit and brute-force protection.** Failed passwords and codes are audited and
  rate-limited (10 per minute per IP, 5 codes per minute per user).

- **ADMIN** — full console **plus** the Settings page: AWS/SES credentials, VAPID keys,
  FCM service account, and Team management (invite users, change roles, reset passwords).
- **USER** — the full working console (contacts, segments, templates, campaigns, journeys)
  but no Settings/credentials; enforcement lives in the middleware, not just the nav.

Public (no login): tracking pixel/click, unsubscribe pages, SES webhook, push
subscribe/track APIs, and `/demo/push`.

## Channels

All credentials are configurable from **Settings** (admin) and stored in the database —
env vars work as a fallback. Changes take effect immediately, no restart.

| Channel | Provider | Setup |
|---|---|---|
| Email | Amazon SES | Settings → Email: AWS keys, region, from address; see deliverability below |
| Web push | Web Push / VAPID | Settings → "Generate VAPID keys", then subscribe browsers at `/demo/push` |
| Mobile push | Firebase (FCM, Android + iOS) | Settings → upload service-account JSON (or `FCM_SERVICE_ACCOUNT_JSON`); apps register tokens with the SDK |
| iOS push (direct) | APNs HTTP/2, token auth | Settings → APNs key (.p8), key/team/bundle id (or `APNS_*`) |
| Webhook | — | Always available; destination URL lives on the template |
| SMS | Twilio (Messaging Service or number) | Settings → SMS & WhatsApp (or `TWILIO_*`); delivery receipts and STOP/START via `/api/webhooks/twilio` |
| WhatsApp | Twilio WhatsApp sender | Same settings; approved Content templates (`HX…`) for messages outside the 24-hour window |

**Newsletters and topics.** Settings → *Newsletters & topics* holds subscription groups of two
kinds: a **newsletter** reaches only its subscribers, a **topic** everyone who hasn't opted out.
Pick one on a campaign's audience step, and the console previews reach per platform before you
send. Readers manage them in-app (`setPreferences` accepts ids or slugs), on the email preference
centre, or your backend sets them via `POST /api/v1/subscriptions`.

**All phones.** A push campaign with *All phones* ticked sends one template to every device the
audience has (iOS via APNs, Android via FCM, browsers via web push). Each message is rendered for
its device's provider.

**Best time per reader.** Scheduled campaigns can *deliver at each reader's best time*: every
reader gets the message at the hour they usually engage, from their opens, clicks and app events
over the last 90 days. Readers with no history get the hour most of the audience engages. All
sends land within 24 hours of the start. Breaking news always goes out immediately. See
`src/lib/sendTime.ts`.

**Data warehouse.** Settings → *Data warehouse* turns on a nightly landing of events, messages and
message events in S3 (gzipped NDJSON) and generates the load setup for **Snowflake** (stage +
Snowpipe), **Redshift** (tables + COPY) and **BigQuery** (tables + S3 Data Transfer). Full contact
exports and the workspace export are on demand (`/api/v1/export/*`).

**Integration health.** Failing webhook endpoints, push/email/SMS providers and content feeds raise
an alert that shows on every console page and posts to Slack or Teams, then closes by itself on
recovery. Webhook endpoints that fail 100 times in a row are paused.

**Demo apps.** [`examples/`](examples) holds iOS (Swift), Android (Kotlin) and React Native apps
built on the SDKs, plus a simulator relay so console campaigns reach them without Firebase or an
Apple key. See [examples/README.md](examples/README.md).

### Push delivery options (per template)

| Option | FCM (Android) | APNs / FCM→iOS | Web push |
|---|---|---|---|
| Priority HIGH/NORMAL | `android.priority` | `apns-priority` 10/5 | `Urgency` |
| Collapse key | `collapseKey` + notification `tag` | `apns-collapse-id` | `Topic` + `tag` |
| Expire after N s | `ttl` | `apns-expiration` | `TTL` |
| Image | `notification.imageUrl` | `mutable-content` + `imageUrl` | `image` |
| Custom data | `data` | top-level keys | `data` |

Mobile deep links (`myapp://…` or https) are delivered untouched in `url`; opens are
reported by the SDK. Dead tokens (FCM unregistered, APNs 410/BadDeviceToken, web push
404/410) are deactivated automatically so they stop consuming throughput. Campaigns can
be flagged **breaking news** to bypass quiet hours and frequency caps.

## Email deliverability — how mail stays out of spam

Sending code (automatic, on every campaign email):

- `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058 — required by Gmail/Yahoo for bulk senders)
- Visible unsubscribe footer injected when the template doesn't place `{{unsubscribeUrl}}`
- A `text/plain` alternative part is always sent (derived from HTML when absent)
- Suppression list (unsubscribes, bounces, complaints) checked immediately before every send
- Sends throttled to your SES max-send-rate (`GetAccount`, or `SES_MAX_SEND_RATE` override)
- Bounce/complaint webhook auto-populates the suppression list

DNS / SES setup (one-time, per sending domain — status shown live on the Settings page):

1. **Verify the domain** as an SES identity (not just an email address).
2. **DKIM**: publish the 3 Easy-DKIM CNAME records; wait for status `SUCCESS`.
3. **Custom MAIL FROM** (`mail.yourdomain.com`): MX `10 feedback-smtp.<region>.amazonses.com`
   and TXT `"v=spf1 include:amazonses.com ~all"` — this makes SPF *align* for DMARC.
4. **DMARC**: TXT at `_dmarc.yourdomain.com`: `"v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com"`,
   tighten to `p=quarantine` once reports look clean.
5. **Leave the SES sandbox**: request production access in the SES console (mention that
   bounces/complaints are handled automatically via SNS → suppression list).
6. **Event notifications**: create a configuration set (`SES_CONFIGURATION_SET`) with an
   SNS event destination for Bounce/Complaint/Delivery, subscribed (HTTPS) to
   `https://your-host/api/webhooks/ses`. Locally: `ngrok http 3000` and set `APP_BASE_URL`.
7. Test with the SES simulator (`bounce@simulator.amazonses.com`, `complaint@simulator.amazonses.com`)
   and check your score at [mail-tester.com](https://www.mail-tester.com) — target 9+/10.
8. Warm up: ramp volume gradually on a fresh domain; don't blast your full list on day one.

## Architecture

```
Next.js app (dashboard UI + API routes)      worker (tsx, separate process)
        │                                          │ polls Job table (1s)
        ├── Postgres ◄──────────────────────────────┤ FOR UPDATE SKIP LOCKED
        │     contacts, segments, templates,        │
        │     campaigns, variants, messages,        ├── channel adapters
        │     events, suppressions, journeys, jobs  │     SES / web-push / FCM / webhook
        └── tracking endpoints                      └── retries w/ backoff, rate limiting
              /api/t/o (open pixel)
              /api/t/c (click redirect)
              /u/[token] (one-click unsubscribe)
              /api/webhooks/ses (SNS events)
              /api/track (custom events)
```

- **Campaign send**: launch → `LAUNCH_CAMPAIGN` job → audience resolved in pages of 500 →
  one `Message` row per recipient (weighted-random A/B variant) → one `SEND_MESSAGE` job each →
  adapter → status transitions `QUEUED → SENDING → SENT → DELIVERED/BOUNCED/FAILED`.
- **Journeys** (Canvas-style): a flow of steps built visually in the console — *send message*
  (any channel, including all phones), *delay*, *condition split* (profile attributes, segment,
  did an event, opened/clicked an earlier step's message, subscribed to a newsletter, reachable
  by push/email), *A/B split* (weighted, stable per reader), *wait for event* (with a timeout
  branch) and *exit*. Readers enter from a segment at activation or when they do an entry event,
  and leave early on an exit event. Each reader advances through scheduled `JOURNEY_STEP` jobs
  claimed atomically, so a duplicate job never sends twice. The journey page shows how many
  readers passed each step and took each branch. Older linear journeys keep working.
- **Tracking URLs are HMAC-signed** (`TRACKING_SECRET`) — the click redirect only follows
  signed destinations, so it is not an open redirect.
- All timestamps of note: `sentAt, deliveredAt, openedAt, clickedAt` per message, plus a
  `MessageEvent` audit trail (repeat opens/clicks, bounce subtypes, unsubscribes).

## APIs

Two key types (Settings → REST API keys):

- **SDK keys** (`dk_pub_…`) ship inside apps. They can only identify users, track events,
  register push tokens and report deliveries/opens.
- **Server keys** (`dk_…`) stay on your backend. They're needed for sends, bulk updates
  and exports, and those endpoints never run without a key.

Every key is rate-limited per minute (`API_RATE_LIMIT_*_PER_MIN`, shared across instances
through Postgres). Responses carry `X-RateLimit-Limit/Remaining/Reset`, and a request over
the limit gets `429` with `Retry-After`. Nothing from a rejected request is accepted or
silently dropped.

### Client SDK — `/api/sdk/v1/*` (CORS-enabled; used by [`packages/react-sdk`](packages/react-sdk))

```
POST /api/sdk/v1/identify        { anonymousId?, externalId?, email?, firstName?, attributes? }
POST /api/sdk/v1/events          { anonymousId|externalId, events: [{ name, properties?, timestamp? }] }   ≤100
POST /api/sdk/v1/push/register   { anonymousId|externalId, channel: FCM|APNS|WEB_PUSH, token|subscription, platform?, deviceId? }
POST /api/sdk/v1/push/unregister { channel, token }
POST /api/sdk/v1/push/received   { messageId }      device-side delivery receipt
POST /api/sdk/v1/push/opened     { messageId }      tap / cold start
GET  /api/sdk/v1/preferences     ?externalId|anonymousId
PUT  /api/sdk/v1/preferences     { …, groups: { <groupId>: bool } }
GET  /api/sdk/v1/config          web push VAPID key
```

Users can be anonymous (an `anonymousId` from the SDK) and still hold devices, events and
preferences. At sign-in, `identify` with both ids merges the anonymous profile into the
known one.

### Server — `/api/v1/*` (server key required)

```
POST /api/v1/campaigns/trigger   { campaignId, recipients?: [{ externalId|email|contactId }] ≤1000 }
                                 no recipients = broadcast to the campaign segment now
POST /api/v1/users/track         { attributes: [...≤100], events: [...≤100] }  bulk profile/event ingest
POST /api/v1/users/delete        { externalIds?, emails? }       right to erasure
GET  /api/v1/users/export        ?externalId|email               data subject access request (JSON)
GET  /api/v1/export/contacts     NDJSON stream: every profile + raw device tokens (portability)
POST /api/v1/exports             { type: contacts|events|messages|message_events, since?, until? }
                                 async → s3://$EXPORT_S3_BUCKET/…/part-*.ndjson.gz + manifest.json
POST /api/v1/sdk-tokens          { externalId } → userToken (when SDK_REQUIRE_USER_TOKEN=true)
GET  /api/v1/subscriptions       newsletters + topics (id, slug, kind)
POST /api/v1/subscriptions       { updates: [{ externalId|email|anonymousId, groups: { "<id|slug>": bool } }] ≤100 }
```

### Live Activities (iOS) and Live Updates (Android)

```
POST /api/v1/live-activities                 { key, activityType, attributes, contentState, alert?, start?, segmentId? }
POST /api/v1/live-activities/<key>/update    { contentState, alert?, staleDate?, relevanceScore?, priority? }
POST /api/v1/live-activities/<key>/end       { contentState, dismissalDate? }
POST /api/v1/live-activities/<key>/followers { externalIds, unfollow? }     Android server-side follow
GET  /api/v1/live-activities/<key>           state + attached device counts
```

- **iOS** sends ActivityKit pushes (`apns-push-type: liveactivity`) over the direct APNs
  connection. Push-to-start (iOS 17.2+) reaches every device that registered a
  push-to-start token for the activity type, optionally narrowed to a segment. Once an
  activity is running, each device reports its own update token through the SDK.
- **Android** gets data-only FCM messages (`dispatchType: live_update`). The app renders
  them as a progress-style ongoing notification; `extractLiveUpdate()` in the SDK parses them.
- **Dead tokens** are deactivated automatically, the same as regular push.

### Twilio Segment

- **Segment to Dispatch.** Add Segment's Webhooks destination with URL
  `https://<host>/api/integrations/segment` and header `Authorization: Bearer <server key>`.
  It handles `identify` (traits become profile fields and attributes; `locale` becomes the
  language), `track`, `page`, `screen` and `alias` (merges profiles), single or batched.
  Push tokens in `context.device.token` are registered too, so push keeps working with
  cloud-mode Segment.
- **Dispatch to Segment.** Settings → Event webhooks → *Twilio Segment*, with a write key
  and US or EU region. Message events go to Segment's HTTP Tracking API as spec track
  calls: `Push Notification Received`, `Push Notification Tapped`, `Email Opened`,
  `Email Link Clicked` and so on. The event id is the Segment `messageId`, so retries dedupe.

### In-app messages and message centre

- **Channel.** `IN_APP` campaigns render a message (pop-up, banner, full screen, or
  message-centre-only) with title, body, image, a tap link and up to two buttons.
  Messages expire after `inAppExpiresHours` (default 30 days).
- **Delivery.** Nothing is pushed: the SDK pulls the user's message centre, so it reaches
  people who never granted notification permission. Quiet hours and frequency caps don't
  apply to it.
- **Tracking.** Fetching counts as delivered; showing or reading counts as opened; a
  button tap counts as clicked. Each call is checked against the calling user, so one
  user can't read or change another's messages.

```
GET  /api/sdk/v1/inbox            ?externalId|anonymousId        → { unread, messages[] }
POST /api/sdk/v1/inbox/read       { …identity, messageIds }
POST /api/sdk/v1/inbox/delete     { …identity, messageIds }
POST /api/sdk/v1/inbox/displayed  { …identity, messageIds }       pop-up shown
POST /api/sdk/v1/inbox/clicked    { …identity, messageIds, url? }
```

In the SDK, `useInbox()` and `useInAppMessage()` work for React and React Native;
`<DispatchInAppMessage/>` (from `@dispatch/react-sdk/web`) is a drop-in renderer for the web.

### Content cards

A persistent feed of cards inside the app, next to the message centre: campaign channel
**Content cards** (`CONTENT_CARD`). Templates choose a style (classic with thumbnail, captioned
image or image-only banner) and can pin the card to the top, stop readers from dismissing it, and
put it in a category so apps can show separate feeds. Everything else works as for other channels:
segments, newsletters, personalisation ({{recommendation.1.title}}), translations, A/B variants
and expiry. Reports count delivery when the app fetches the feed, opens as impressions and
clicks as taps.

SDKs: `useContentCards()` / `getCards()` (React), `contentCards()` (iOS, Android), plus
`logCardsViewed`, `logCardClicked` and `dismissCards`. The demo apps show the feed at the top of
**For you** (`npm run demo -- cards`).

### Article recommendations and feed-driven sends

- **Catalog.** Articles come from RSS, Atom or JSON Feed URLs polled by the worker
  (Content → Articles & feeds), or from your CMS through `POST /api/v1/content/items`.
- **Reads.** A read is any event in `RECO_READ_EVENTS` (default `article_read`) whose
  properties carry the article id. The SDK's `articleRead(id)` sends one.
- **Scoring.** `for_you` = 0.5 × section/tag affinity from the reader's last 30 days +
  0.3 × 24 h popularity + 0.2 × freshness (12 h half-life). There's also `trending` and
  `latest`.
- **Exclusions.** Articles the reader read, or was already sent in the last 7 days, never
  come back. Articles in another language are skipped for readers with a language set.
- **In templates.** Use `{{recommendation.1.title}}`, `{{recommendation.1.url}}`… (1–5)
  or `{{trending.N.*}}`. Recommendations are computed once per 500-message batch, so a
  personalised broadcast costs about the same as a plain one. A reader with nothing left
  to recommend is skipped (`SUPPRESSED`), not sent a blank.
- **Auto-send.** Give a feed an auto-send campaign and every new article launches it,
  with `{{item.title}}`, `{{item.url}}`, `{{item.summary}}`, `{{item.imageUrl}}`. A
  feed's first fetch only imports, and only articles under `FEED_AUTOSEND_MAX_AGE_MIN`
  (120) are sent. `POST /api/v1/content/items` with `sendCampaignId` does the same from a CMS.
- **APIs.** `GET /api/sdk/v1/recommendations`, `GET /api/v1/recommendations`.

### Languages

Contacts carry a `language` (BCP-47). The SDK sends the device locale, and Segment's
`locale` trait and the bulk API set it too. Templates hold per-language overrides
(Templates → Translations). A contact gets the most specific match (`pt-BR`, then `pt`),
field by field, and anyone without a match gets the default content. Segments can filter
on `language`.

### Event webhooks (outbound)

Settings → Event webhooks streams `message.sent|delivered|failed|bounced|opened|clicked|converted`
to your endpoint as JSON batches signed with `X-Dispatch-Signature: t=<unix>,v1=<hmac-sha256(secret, "t.body")>`.
Delivery is at-least-once with retries, so dedupe on the event `id`.

### Legacy endpoints (still supported)

```
POST /api/track                { externalId|email|contactId, event, properties? }
POST /api/push/subscribe       { email, subscription }
POST /api/push/register-token  { email|externalId, token, platform }
POST /api/test-send            { templateId, toEmail }
```

Segments can filter on standard fields, `attributes.<key>` (custom JSON attributes), and
`event.<name>` (contact did / did not perform the event).

## Deploying to AWS

`infra/aws` is a Terraform stack. It creates:

- a VPC across 2 AZs, with private subnets and a NAT gateway per AZ (`single_nat_gateway` for dev);
- **RDS Postgres 16**: Multi-AZ, encrypted, 14-day backups, SSL enforced, deletion protection;
- **ECS Fargate**: a `web` service behind an ALB (HTTPS, health check on `/api/health`) and a
  separate `worker` service with a container health check on `:8081/health`. Both autoscale on CPU
  and roll back automatically on failed deploys;
- an **IAM task role** covering SES send, S3 media and S3 exports, so there are no AWS keys in the app;
- **Secrets Manager** for `DATABASE_URL`, `TRACKING_SECRET`, and optionally `FCM_SERVICE_ACCOUNT_JSON` and `APNS_PRIVATE_KEY`;
- **S3 + CloudFront** for media (push images), plus an S3 bucket for exports (expires after 30 days);
- an **SES configuration set** that sends events to SNS and on to `/api/webhooks/ses`, where SNS signatures
  are verified and only the stack's topic is accepted;
- ECR and CloudWatch Logs.

```bash
cd infra/aws
cp example.tfvars prod.tfvars          # domain, ACM cert, SES sender, region
terraform init && terraform apply -var-file=prod.tfvars
# point the domain at output alb_dns_name, add output ses_dkim_cname_records to DNS
cd ../.. && TFVARS=prod.tfvars scripts/aws-deploy.sh   # build → push → migrate → roll out
```

Push credentials: put the FCM service-account JSON or APNs `.p8` into the secrets named in the
`push_secret_arns` output, then set `enable_fcm_secret` / `enable_apns_secret = true`. APNs ids go
in `extra_environment`. Or skip the secrets and use the Settings page.

Monitoring (`infra/aws/monitoring.tf`, `waf.tf`):

- **Metrics.** The worker publishes queue depth, oldest-job age, sent/failed counts and
  failing integrations/feeds as CloudWatch metrics (embedded-metric logs, no SDK).
- **Alarms.** These cover API 5xx/latency, unhealthy tasks, no running worker, backlog,
  stale jobs, send failures, failing webhooks or feeds, and RDS CPU/storage. They go to
  `alert_email`.
- **Scaling.** Workers add capacity on queue depth (step scaling), not only CPU.
- **Dashboard and WAF.** A CloudWatch dashboard shows the lot, and AWS WAF (managed rules
  plus a per-IP rate limit) sits in front of the ALB.
- **Runbooks.** See [docs/operations.md](docs/operations.md) for on-call runbooks and
  [docs/security.md](docs/security.md) for the controls matrix.

Operational notes:

- **Data residency.** Everything runs in the one `region` you choose, and nothing leaves it except
  calls to FCM, APNs and the push services.
- **Scaling.** Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so adding tasks adds throughput.
  A launch splits the audience into `LAUNCH_PARTITIONS` contact-id ranges, default 8, which fan
  out in parallel. Push jobs carry 500 messages each: FCM goes out through `sendEach` and APNs
  through multiplexed HTTP/2 streams. Each worker keeps `WORKER_BATCH_SIZE` jobs in flight and
  needs `DB_POOL_SIZE` of at least that plus 5. `WORKER_COUNT` splits the SES quota between tasks.
- **Load test.** `npm run loadtest -- --devices 1000000 --workers 4` seeds synthetic devices into
  the database in `DATABASE_URL`, runs real workers against a mock provider
  (`PUSH_PROVIDER_MODE=mock`, which is refused in production), and reports fan-out time,
  p50/p95/p99 hand-off and throughput. Point it at a dedicated database.
- **Deploys.** SIGTERM drains the in-flight batch (`stopTimeout` 120s). A message is claimed
  atomically before sending, and one interrupted mid-send is marked failed instead of re-sent,
  so there are no duplicate alerts.
- **Retention.** `MESSAGE_RETENTION_DAYS`, `EVENT_RETENTION_DAYS` and `AUDIT_RETENTION_DAYS`
  (default 400) are purged hourly by the worker.
- **Audit log.** Every console sign-in, failed login, state-changing request, and API
  export or deletion is recorded (Settings → Audit log, with CSV export).

## Development notes

- `npx prisma studio` — browse the DB.
- The worker and app share `src/lib/`; the queue is isolated in `src/lib/queue/` if you
  ever want to swap it for BullMQ.
- Kill the worker mid-campaign and restart it. Running jobs heartbeat every minute, and a job
  with no heartbeat for 5 minutes goes back to the queue. Messages are claimed atomically
  (`QUEUED → SENDING`), so already-sent messages are never sent again.
- `npm test` runs the server tests (DB tests use `DATABASE_URL`). `npm run test:sdk` runs the SDK tests.
