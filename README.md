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
```

Open http://localhost:3000 and sign in. The seed creates a default admin —
**admin@dispatch.local / admin123!** — change it right away (Settings → Team). On a fresh
DB without seeding, the login page offers a first-run "create admin account" step instead.

## Accounts & roles

Login uses DB-backed accounts (scrypt-hashed passwords, signed session cookie).

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
| Mobile push | Firebase (FCM, Android + iOS) | Settings → upload service-account JSON; apps register tokens via `POST /api/push/register-token` |
| Webhook | — | Always available; destination URL lives on the template |
| APNs direct / SMS / WhatsApp | — | Stubs — show "not configured" (need Apple Developer / Twilio accounts) |

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
- **Journeys** (Canvas-lite): entry segment → ordered steps (`wait N minutes → send template`);
  each contact advances via scheduled `JOURNEY_STEP` jobs.
- **Tracking URLs are HMAC-signed** (`TRACKING_SECRET`) — the click redirect only follows
  signed destinations, so it is not an open redirect.
- All timestamps of note: `sentAt, deliveredAt, openedAt, clickedAt` per message, plus a
  `MessageEvent` audit trail (repeat opens/clicks, bounce subtypes, unsubscribes).

## API surface (for your app/site)

```
POST /api/track                { email, event, properties? }     # custom events
POST /api/push/subscribe       { email, subscription }           # browser web-push
POST /api/push/register-token  { email, token, platform }        # mobile FCM/APNs token
POST /api/test-send            { templateId, toEmail }           # one-off test message
```

Segments can filter on standard fields, `attributes.<key>` (custom JSON attributes), and
`event.<name>` (contact did / did not perform the event).

## Development notes

- `npx prisma studio` — browse the DB.
- The worker and app share `src/lib/`; the queue is isolated in `src/lib/queue/` if you
  ever want to swap it for BullMQ.
- Kill the worker mid-campaign and restart it — a reaper returns stuck jobs to the queue
  and already-sent messages are skipped (status guard), so nothing double-sends.
