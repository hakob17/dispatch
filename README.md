# Dispatch — a self-hosted customer engagement platform

A Braze-style platform for news and media apps: push, in-app and email at newsroom speed,
run in your own AWS account.

- **Channels:** mobile push (APNs direct and FCM), web push, email (SES), SMS and WhatsApp
  (Twilio), in-app messages and message centre, content cards, and webhooks.
- **Campaigns:** A/B tests with control groups and lift, scheduled, recurring, event-triggered
  and API-triggered sends, breaking-news priority, one campaign to all phones, and delivery
  at each reader's best time.
- **Journeys:** a visual builder with messages, delays, condition splits, A/B splits,
  wait-for-event and exits.
- **Audiences:** segments, newsletters (opt-in) and topics (opt-out), a preference centre,
  quiet hours and frequency caps.
- **Personalisation:** article recommendations, RSS/Atom feed auto-sends, per-language
  templates, Live Activities and Android Live Updates.
- **SDKs:** React / React Native, iOS (Swift) and Android (Kotlin), plus demo apps for all three.
- **Data:** Segment in and out, signed event webhooks, S3 exports, warehouse loads for
  Snowflake, Redshift and BigQuery, and full export for exit.
- **Security and operations:** SSO (OIDC or SAML, e.g. Ping Identity), two-step verification,
  audit log, rate limits, integration-failure alerts, CloudWatch alarms, and Terraform for AWS.

Built with Next.js (App Router) + TypeScript, Postgres + Prisma, and a DB-backed job queue
processed by separate worker processes. No Redis required.

## Repository layout

| Path | What |
|---|---|
| `src/app` | Console UI (`(dashboard)`) and all HTTP APIs (`api/`) |
| `src/lib` | Domain logic shared by the app and the worker: channels, journeys, recommendations, SSO… |
| `worker/` | Job-queue worker: campaign launch and fan-out, sending, journeys, feeds, exports |
| `prisma/` | Schema and migrations |
| `packages/react-sdk` | React / React Native / web SDK |
| `packages/ios-sdk` | iOS SDK (Swift Package) with a notification service extension |
| `packages/android-sdk` | Android SDK (Kotlin, Gradle module `:dispatch`) |
| `examples/` | Demo apps for iOS, Android and React Native ([guide](examples/README.md)) |
| `infra/aws` | Terraform for the AWS deployment |
| `scripts/` | Load test (`npm run loadtest`), demo driver (`npm run demo`), AWS deploy |
| `docs/` | API reference, operations runbooks, security, accessibility, SDK footprint |

## Quick start

```bash
npm install
createdb dispatch_dev                # local Postgres
cp .env.example .env                 # set DATABASE_URL at minimum
npx prisma migrate deploy
npm run db:seed                      # demo contacts, a segment, templates and an admin account

npm run dev                          # console + API on :3000
npm run worker                       # job-queue worker (second terminal)
```

Open http://localhost:3000 and sign in. The seed creates a default admin —
**admin@dispatch.local / admin123!** — change it right away (Settings → Team). On a fresh
database without seeding, the login page offers a first-run "create admin account" step instead.

To try it end to end without Apple or Google credentials, run the demo apps: `npm run demo -- setup`,
`npm run worker:demo`, then follow [examples/README.md](examples/README.md).

Tests: `npm test` (server; database tests use `DATABASE_URL`), `npm run test:sdk` (React SDK),
`swift test` in `packages/ios-sdk`, `./gradlew :dispatch:testDebugUnitTest` in `packages/android-sdk`.

## Accounts & roles

Login uses DB-backed accounts (scrypt-hashed passwords, signed session cookie).

- **Single sign-on: OIDC or SAML 2.0.** Works with Ping Identity (PingFederate / PingOne, with
  PingID multi-factor enforced by Ping), Okta, Microsoft Entra ID, ADFS, Google Workspace and any
  other OIDC or SAML provider. Configure it under Settings → Single sign-on, or with `OIDC_*` /
  `SAML_*` env vars.
  - OIDC uses the authorization-code flow with PKCE.
  - SAML requires signed assertions and one-use `InResponseTo`, and checks audience and validity
    window. SP metadata is at `/api/auth/sso/saml/metadata`.
  - Accounts can be limited to allowed email domains and created on first sign-in. Admin rights
    can come from IdP groups (`groups` / `memberOf`), checked at every sign-in.
  - Ping setup steps are in [docs/security.md](docs/security.md).
- **Two-step verification (TOTP).** Works with any authenticator app. Users get 10 one-time
  recovery codes, and secrets are AES-GCM encrypted (`MFA_ENCRYPTION_KEY`). Users manage it
  on the Account page; admins can reset it for someone who lost their phone.
- **Sign-in policy.** "Require two-step verification" makes users enrol at their next
  sign-in. "Only allow single sign-on" turns off passwords for everyone except admins, who
  keep them (with 2FA) as break-glass access.
- **Audit and brute-force protection.** Failed passwords and codes are audited and
  rate-limited (10 per minute per IP, 5 codes per minute per user).

- **ADMIN** — full console **plus** the Settings page: channel credentials (SES, VAPID, FCM,
  APNs, Twilio), newsletters and topics, API keys, webhooks, integration health, data warehouse,
  single sign-on, sign-in policy, audit log, and Team management.
- **USER** — the full working console (contacts, segments, templates, campaigns, journeys)
  but no Settings/credentials; enforcement lives in the middleware, not just the nav.

Public (no login, authenticated some other way): the SDK and server APIs (API keys), tracking
pixel/click and unsubscribe pages (signed tokens), provider webhooks (SES/SNS signatures, Twilio
signatures), SSO callbacks, and `/demo/push`.

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
Next.js app (console UI + APIs)              worker (separate process, scales horizontally)
        │                                          │ claims jobs: FOR UPDATE SKIP LOCKED
        ├── Postgres ◄──────────────────────────────┤ heartbeats; stuck jobs are retried
        │     contacts, devices, segments,         │
        │     templates, campaigns, messages,      ├── launch & fan-out (partitioned)
        │     journeys, events, content, jobs      ├── channel adapters
        └── public endpoints                       │     APNs · FCM · web push · SES ·
              /api/sdk/v1/*   (SDK key)            │     Twilio SMS/WhatsApp · in-app · cards · webhook
              /api/v1/*       (server key)         ├── journeys, feeds, Live Activities
              /api/t/o, /api/t/c (tracking)        ├── webhooks out, Segment out, S3 exports
              /u/[token] (unsubscribe)             └── metrics, alerts, retention purges
              /api/webhooks/ses, /twilio
```

- **Campaign send.** Launching creates a `LAUNCH_CAMPAIGN` job. The audience is split into
  `LAUNCH_PARTITIONS` contact-id ranges that fan out in parallel. Each recipient device gets a
  `Message` row (weighted-random A/B variant, control-group holdouts marked). Messages go out in
  `SEND_BATCH` jobs of 500 (FCM `sendEach`, APNs HTTP/2 streams). Statuses move
  `QUEUED → SENDING → SENT → DELIVERED` (or `BOUNCED` / `FAILED` / `SUPPRESSED`), and opens and
  clicks are timestamped on the message.
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

### Client SDK — `/api/sdk/v1/*` (SDK key, CORS-enabled)

The SDKs wrap these; the full reference with rate limits and error bodies is in
[docs/api.md](docs/api.md).

```
POST /api/sdk/v1/identify        { anonymousId?, externalId?, email?, firstName?, language?, attributes? }
POST /api/sdk/v1/events          { anonymousId|externalId, events: [{ name, properties?, timestamp? }] }   ≤100
POST /api/sdk/v1/push/register   { anonymousId|externalId, channel: FCM|APNS|WEB_PUSH, token|subscription, platform?, deviceId? }
POST /api/sdk/v1/push/unregister { channel, token }
POST /api/sdk/v1/push/received   { messageId }      device-side delivery receipt
POST /api/sdk/v1/push/opened     { messageId }      tap / cold start
GET  /api/sdk/v1/preferences     ?externalId|anonymousId          newsletters + topics with state
PUT  /api/sdk/v1/preferences     { …, groups: { "<id or slug>": bool } }
GET  /api/sdk/v1/inbox           message centre + pending in-app messages   (see below)
GET  /api/sdk/v1/cards           content-card feed                          (see below)
GET  /api/sdk/v1/recommendations ?strategy=for_you|trending|latest
POST /api/sdk/v1/live-activities/token | push-to-start | follow
GET  /api/sdk/v1/config          web push VAPID key
```

Users can be anonymous (an `anonymousId` from the SDK) and still hold devices, events and
preferences. At sign-in, `identify` with both ids merges the anonymous profile into the
known one.

### SDKs

| SDK | Platforms | Install | Size |
|---|---|---|---|
| [`packages/react-sdk`](packages/react-sdk) | React Native, React web (TypeScript, no dependencies) | local package `@dispatch/react-sdk` | 4.8 KB gzipped |
| [`packages/ios-sdk`](packages/ios-sdk) | iOS 15+, Swift 6 (Swift Package), notification service extension | Swift Package from this repo | ~254 KB |
| [`packages/android-sdk`](packages/android-sdk) | Android 6.0+ (minSdk 23), Kotlin | Gradle module `:dispatch` | ~42 KB in the APK |

All three cover identity with anonymous-to-known merge, event tracking, push token registration,
delivery and open reporting, newsletters and topics, the message centre, in-app messages,
content cards, recommendations, and Live Activities / Android Live Updates.

The SDKs never show the permission prompt; the app decides when to ask. Deep links go to the
app's own navigation. Each SDK's README has the integration steps, and
[docs/sdk-footprint.md](docs/sdk-footprint.md) has the size and startup measurements.

### Server — `/api/v1/*` (server key required)

```
POST /api/v1/campaigns/trigger   { campaignId, recipients?: [{ externalId|email|contactId }] ≤1000 }
                                 no recipients = broadcast to the campaign segment now
POST /api/v1/users/track         { attributes: [...≤100], events: [...≤100] }  bulk profile/event ingest
POST /api/v1/users/delete        { externalIds?, emails? }       right to erasure
GET  /api/v1/users/export        ?externalId|email               data subject access request (JSON)
GET  /api/v1/export/contacts     NDJSON stream: every profile + raw device tokens (portability)
GET  /api/v1/export/workspace    JSON: segments, templates, newsletters, campaigns + history, journeys, suppressions
POST /api/v1/exports             { type: contacts|events|messages|message_events, since?, until? }
                                 async → s3://$EXPORT_S3_BUCKET/…/part-*.ndjson.gz + manifest.json
POST /api/v1/sdk-tokens          { externalId } → userToken (when SDK_REQUIRE_USER_TOKEN=true)
GET  /api/v1/subscriptions       newsletters + topics (id, slug, kind)
POST /api/v1/subscriptions       { updates: [{ externalId|email|anonymousId, groups: { "<id|slug>": bool } }] ≤100 }
POST /api/v1/content/items       publish articles to the catalogue (optionally auto-send)
GET  /api/v1/recommendations     ?externalId&strategy&limit       what a reader would be recommended
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
and `contact.unsubscribed` to your endpoint as JSON batches signed with `X-Dispatch-Signature: t=<unix>,v1=<hmac-sha256(secret, "t.body")>`.
Delivery is at-least-once with retries, so dedupe on the event `id`. An endpoint that keeps failing
raises an integration alert and is paused after 100 consecutive failures.

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
- After a schema change, create the migration, run `npx prisma migrate deploy`, then restart
  `npm run dev` and the worker so they load the new Prisma client.
- The worker and app share `src/lib/`; the queue is isolated in `src/lib/queue/` if you
  ever want to swap it for BullMQ.
- Kill the worker mid-campaign and restart it. Running jobs heartbeat every minute, and a job
  with no heartbeat for 5 minutes goes back to the queue. Messages are claimed atomically
  (`QUEUED → SENDING`), so already-sent messages are never sent again.
- `PUSH_PROVIDER_MODE=mock` swaps push, SMS and WhatsApp providers for a mock (load tests,
  demos). It's refused in production unless `LOADTEST_ALLOW_MOCK=true`.

## Documentation

- [docs/api.md](docs/api.md) — API reference, rate limits, errors, outbound events
- [docs/operations.md](docs/operations.md) — alarms, runbooks, scaling, load testing
- [docs/security.md](docs/security.md) — controls matrix, single sign-on (incl. Ping Identity), known gaps
- [docs/accessibility.md](docs/accessibility.md) — WCAG 2.2 AA audit of the console and SDK UI
- [docs/sdk-footprint.md](docs/sdk-footprint.md) — SDK size and startup impact
- [examples/README.md](examples/README.md) — demo apps and the simulator relay
