# Reader messaging in-house: the case for Dispatch

**Recommendation:** answer the push RFP with an in-house platform, not a vendor. We don't
need permission to build it; it is already built. What we are asking for is an **8-week pilot**
and a go/no-go decision at the end of it.

---

## 1. The decision in one page

The RFP asks for a platform that sends push, in-app, email and SMS to Reuters readers. It should
be fast enough for breaking news, integrate with our identity (Ping) and data stack (AWS,
warehouse), and be safe to run at our scale.

There are two ways to get one:

| | Buy (Braze, Airship, OneSignal, Iterable…) | Build and own (Dispatch) |
|---|---|---|
| Time to first send | Weeks (contract, security review, SDK integration) | Weeks (the prototype already sends to iOS, Android and web) |
| Cost driver | Licence per monthly active user and per message: it rises with audience growth | AWS infrastructure plus the team: it rises with engineering effort, not readers |
| Reader data | Copied to the vendor's cloud | Stays in the TR AWS account |
| Breaking-news speed | Shared multi-tenant queue; priority is a vendor feature | Our own queue and workers; we decide what goes first |
| Newsroom features | Generic marketing tool, bent to fit news | Built for news: feed auto-send, live activities, recommendations |
| Roadmap | The vendor's | Ours |
| Exit | Migration project, data export by contract | Nothing to exit |
| Maturity, SLA, 24/7 support | Strong | We provide them ourselves (see section 5) |

**The short version:** a vendor makes sense if we don't want to own the capability. For a news
organisation, reader messaging is the capability. It's how breaking news reaches people first,
and it's where our reader data lives.

## 2. Feasibility: this is not a slide, it runs

Over a few weeks we built a working prototype, Dispatch. It is Braze-comparable and runs in our
own AWS account.

**What it does today**
- **Channels:** APNs and FCM push, web push, in-app messages, a message centre, content cards,
  email (SES), SMS and WhatsApp (Twilio), and webhooks.
- **Campaigns:**
  - scheduled, recurring, event-triggered and API-triggered sends;
  - A/B tests with control groups;
  - a breaking-news priority that bypasses quiet hours and frequency caps;
  - one campaign sent to every device (iOS, Android and web);
  - delivery at each reader's best time.
- **Journeys:** a visual builder with branching (conditions, A/B splits, wait-for-event, exits),
  plus live counts on every step.
- **Newsroom-specific:** RSS/Atom feed auto-send, "recommended for you" pushes, Live Activities
  and Android Live Updates for election night, newsletters (opt-in) and topics (opt-out).
- **SDKs:** iOS (Swift), Android (Kotlin), React Native and web.
  - Small footprint: about 5 KB gzipped on the web, about 42 KB on Android, about 254 KB on
    iOS before stripping.
  - A demo app for each platform.
- **Enterprise:**
  - SSO through **Ping** (SAML 2.0 with PingID multi-factor, or OIDC);
  - two-step verification, audit log and rate limits;
  - alerts when an integration keeps failing;
  - warehouse loads to Snowflake, Redshift or BigQuery;
  - full data export.

**Evidence**
- **RFP coverage:** 56 of 67 technical requirements answered "Yes", 6 "Partial" and 5 "No".
  Every gap is an operational task (a test, an audit or an exercise), not a missing feature. See
  section 5.
- **Throughput:** 1,000,000 devices handed to the provider in **88.6 s** (about 720,000 messages
  per minute).
  - Measured on one laptop with 4 workers, against a mock provider that adds 400 ms of latency
    per 500-message call.
  - On AWS, throughput scales out with more worker tasks.
- **Tests:** a server suite, a React SDK suite, iOS unit tests and Android unit tests, all green.
  The console scores 0 violations in an automated WCAG 2.2 AA check (axe).
- **Demo video:** one console campaign reaches a Swift iOS app, a React Native app, an Android
  app and a web browser. It also shows a newsletter, content cards, a branching journey and
  in-app messages.

**Stack.** Everything uses tools TR already runs: TypeScript (Next.js), Postgres, and ECS on AWS,
provisioned with Terraform. There is no Redis, no Kafka and nothing exotic to operate.

## 3. Why in-house is better for Reuters specifically

1. **Reader data stays with us.** Device tokens, reading behaviour and subscriptions never leave
   the TR AWS account. That means:
   - no third-party data processor to assess for this data;
   - no cross-border transfer questions;
   - no dependence on a vendor's breach record.
2. **Breaking news is our product, so its speed should be ours.**
   - A multi-tenant vendor sends our alert through the same queue as everyone else's
     promotions.
   - With Dispatch, a breaking alert jumps the queue, and we can add workers ahead of an
     expected spike such as an election or a major verdict.
   - We choose the send-latency target and can measure against it end to end.
3. **Cost follows infrastructure, not audience.**
   - Vendor pricing grows with monthly active users and message volume. Success, meaning more
     readers and more alerts, raises the bill every year.
   - In-house cost is mostly a fixed team plus AWS, which is cheap per message at our volumes.
4. **Features built for a newsroom, not a retailer.**
   - Feed-driven auto-sends, per-language templates, Live Activities for live stories,
     article recommendations and newsletter management are first-class features.
   - With a vendor, these are workarounds or paid add-ons.
5. **It plugs into what we already have.**
   - Sign-in uses Ping, with the same MFA and groups as everything else.
   - Data lands in our warehouse every night.
   - The CMS or wire feed can trigger sends directly through the API.
   - Audit and monitoring go to CloudWatch, which our operations team already watches.
6. **No lock-in and no exit project.**
   - The SDKs, data model and history are ours.
   - A vendor switch later would mean re-integrating SDKs in every app and migrating years of
     reader data. Owning it avoids that for good.
7. **We control the roadmap.** When Apple or Google ship something new, such as Live
   Activities, we can have it in our apps on our own timeline. We don't wait for a vendor to
   prioritise it.

## 4. What a vendor does better, stated honestly

A credible pitch has to name these:

| Vendor strength | What it means for us | How we cover it |
|---|---|---|
| Years of production hardening at huge scale | Our code has not yet carried real traffic | Pilot with a shadow run before any cut-over (section 6) |
| Contractual SLA and 24/7 support | We are the support | Put it on the platform team's on-call rota; Multi-AZ design; runbooks already in `docs/operations.md` |
| Certifications (SOC 2, ISO) and a pen-tested product | We have neither yet | External pen test before go-live; it is covered by TR's own certifications |
| Email deliverability expertise | Reputation management is a skill | SES with DKIM, DMARC and suppression already done; keep email on the incumbent tool at first if preferred |
| Deep marketing analytics UI | Dispatch reports are functional, not rich | Warehouse export: analysts use our existing BI tools |
| A team that tracks every OS and provider change | We absorb APNs and FCM changes ourselves | This is small, well-documented work; the SDKs are thin by design |

**The real cost of building is ownership:** a small, permanent team and on-call. If TR isn't
willing to fund that, buy.

## 5. What's left before production

These are the RFP items not yet marked "Yes", turned into a checklist:

| Gap | RFP | Work | Effort |
|---|---|---|---|
| Throughput on real infrastructure | 1.1, 1.3 | Load test on AWS staging with real APNs and FCM credentials | 1 week |
| Independent penetration test | 7.1 | External test by TR security or a vendor, then fix the findings | 2–3 weeks elapsed |
| Disaster-recovery exercise | 9.1, 9.2 | Scheduled restore and failover drill; record the recovery point and recovery time achieved | 1 week |
| Regional resilience | 9.3 | Cross-region database replica and a warm standby | 2–3 weeks, if required |
| Availability target | 8.4 | Internal service-level objective (e.g. 99.9%) with alerting | Days |
| Large-volume export | 3.5, 3.6 | Test exports at billions of rows; tune batch sizes | 1 week |
| Accessibility | 5.1, 5.2 | Manual screen-reader pass; VPAT if procurement requires one | 1–2 weeks |

None of these is a research problem. They are the normal steps to production readiness.

## 6. Proposed plan: pilot first, commit later

**Phase 0 — Pilot (8 weeks)**
- Deploy to AWS staging, then production, using the existing Terraform.
- Integrate the SDK into **one** app, for example the Reuters iOS app, behind a feature flag.
- **Shadow run:** send breaking alerts through both the current tool and Dispatch to an internal
  or beta audience, and compare latency, delivery and opens side by side.
- Close the first three items from section 5: real-infrastructure load test, pen test and DR
  drill.

**Go/no-go gate.** Dispatch must meet each of these:
- **Latency:** median alert delivery at or below the current tool's.
- **Reliability:** no lost alerts during the pilot.
- **Security:** no critical pen-test findings open.

**Phase 1 — Mobile push cut-over (next quarter)**
- All apps, breaking news and newsletters.
- The incumbent contract runs down in parallel.

**Phase 2 — Everything else**
- In-app messages, content cards and journeys.
- Email and SMS, if we choose to move them.
- Retire the vendor.

**Hybrid option.** If email deliverability is the main worry, keep email on the incumbent tool
and move push, in-app and web to Dispatch. That is still where most of the value and data
sensitivity is.

## 7. Cost model (to be filled in with TR figures)

| | Vendor, 3 years | Dispatch, 3 years |
|---|---|---|
| Licence and usage fees (MAU- and message-based, with growth) | *from vendor quotes* | — |
| Implementation and professional services | *quote* | — |
| AWS: ECS workers, RDS Postgres Multi-AZ, SES, S3, CloudWatch | — | *AWS pricing calculator on the Terraform footprint* |
| Engineering team (build-out, then run) | Integration and admin, about 1 FTE | About 3 FTE in year 1, then 2 FTE ongoing *(to confirm)* |
| Pen test, DR, audits | Included or partial | *one-off, plus annual* |
| Exit or migration cost at contract end | *SDK re-integration plus data migration* | None |

Two effects push in opposite directions:
- **The vendor bill grows** with readers and message volume.
- **The in-house cost stays fairly flat**, because AWS cost per message is small and the team size
  doesn't change with audience.

Where the two lines cross should be computed from real quotes before the gate. Don't assume it.

## 8. The ask

1. **Approve the 8-week pilot:** a staging and production AWS account, and one app team's time
   to integrate the SDK behind a flag.
2. **Line up TR security** for a pen test in weeks 4–6.
3. **Get vendor quotes** for the 3-year TCO comparison, so the go/no-go decision is made on real
   numbers.

At the gate, the decision is either "own it", backed by measured latency, a clean pen test and
a real cost comparison, or "buy", in which case the pilot cost only the pilot.
