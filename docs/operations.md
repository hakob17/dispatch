# Operations runbook

For whoever is on call for Dispatch on AWS (`infra/aws`). Every alarm below
emails `alert_email` through the `<name>-<env>-alerts` SNS topic. The CloudWatch
dashboard `<name>-<env>` shows all the signals on one screen.

## Signals

| Alarm | Meaning | First look |
|---|---|---|
| `queue-oldest-job` | A due job has waited 5+ minutes, so breaking news is late | Worker running count; `QueueDepth`; worker logs for errors |
| `queue-backlog` | More than `queue_backlog_alarm` jobs are waiting | Normal during a 1M broadcast for about a minute. If it lasts, check that worker autoscaling isn't at `worker_max_count` |
| `worker-not-running` | Zero worker tasks: nothing is being sent | ECS service events (image pull, secrets, crash loop) |
| `send-failures` | 1000+ failed messages in 5 minutes | `Message.error` for the campaign: expired FCM service account or APNs key, SES sending paused |
| `web-5xx`, `web-latency-p95`, `web-unhealthy-targets` | Console and API are degraded | Web logs; `/api/health` fails when the database is unreachable |
| `integrations-failing` | An event webhook or Segment destination has failed 3+ times in a row | Settings → Event webhooks shows `lastError`. Pause the endpoint if the receiver is down, since deliveries keep retrying |
| `feeds-failing` | A content feed can't be fetched, so its auto-sends have stopped | Content → Articles & feeds shows `lastError`; use *check now* after it's fixed |
| `db-cpu`, `db-free-storage` | The database is under pressure | Performance Insights; retention settings (`MESSAGE_RETENTION_DAYS`) |

## Deploy and roll back

```bash
TFVARS=prod.tfvars scripts/aws-deploy.sh            # build → push → migrate → roll out
```

1. The script registers new task definitions and runs `prisma migrate deploy` as a one-off
   task, before any new code serves traffic.
2. The ECS deployment circuit breaker rolls back automatically if new tasks fail their
   health checks.
3. To roll back by hand, redeploy the previous tag:
   `terraform -chdir=infra/aws apply -var image_tag=<previous-sha>`.
4. Migrations are forward-only. Don't roll back across one that drops or renames columns;
   ship a fix-forward instead.
5. Workers drain on SIGTERM (up to 120 s, the in-flight batch finishes). A message
   interrupted mid-send is marked `FAILED` ("interrupted during send"), never sent twice.

## Common incidents

**Breaking news is slow to go out.**
1. Check `OldestPendingJobAgeSeconds` and `QueueDepth`.
2. If the workers are at maximum, raise `worker_max_count` or `LAUNCH_PARTITIONS` (more
   parallel fan-out).
3. If database CPU is saturated, scale the instance class; Multi-AZ fails over in about
   1–2 minutes.
4. The provider rate limits are FCM `sendEach` at 500 per call and APNs over one HTTP/2
   connection per worker with `APNS_CONCURRENCY` streams.

**FCM or APNs outage, or bad credentials.**
- Sends fail as transient and are retried after 1, 5 and 30 minutes.
- Credential errors (`app/invalid-credential`) are retryable, so fixing the secret
  recovers the send.
- Rotate with `aws secretsmanager put-secret-value --secret-id <arn> ...`, then force a new
  deployment of the worker service.
- Nothing is lost while messages are `QUEUED`.

**Duplicate-send worry.** Messages move `QUEUED → SENDING` atomically before a provider
call, and only `QUEUED` messages are ever sent, so retries and the stuck-job reaper can't
double-send.

**Database failover or restore.**
- RDS is Multi-AZ with 14-day point-in-time recovery.
- To restore: `aws rds restore-db-instance-to-point-in-time`, update the `DATABASE_URL`
  secret, then force new deployments of `web` and `worker`.
- The job queue is in the same database, so pending work resumes on its own.

**Suspected credential leak.**
- *API key:* revoke it (Settings → REST API keys). It stops working within 30 s, the
  per-process key cache TTL.
- *Session secret:* rotate `TRACKING_SECRET` (Secrets Manager), which signs everyone out
  and invalidates old unsubscribe and tracking links.
- *MFA secrets:* `MFA_ENCRYPTION_KEY` is separate. Rotating it forces everyone to
  re-enrol in two-step verification.
- *Investigate:* the audit log (Settings → Audit log, CSV export) shows who did what,
  and from which IP.

**Data-subject requests (GDPR / CCPA).**
- *Access:* `GET /api/v1/users/export?externalId=…` returns the full JSON.
- *Erasure:* `POST /api/v1/users/delete {externalIds}` cascades to devices, events,
  messages, preferences and Live Activity tokens. Suppression entries are kept, so
  nobody is re-mailed.
- Both calls are recorded in the audit log.

## Routine

- **Backups.** RDS automated backups run daily 02:00–03:00 UTC with 14-day PITR. Test a
  restore into a scratch instance every quarter and record the result: that is your DR
  test evidence.
- **Retention.** The worker purges data hourly: `AUDIT_RETENTION_DAYS` (400),
  `JOB_RETENTION_DAYS` (7), and optionally `MESSAGE_RETENTION_DAYS` and
  `EVENT_RETENTION_DAYS`.
- **Warehouse.** Yesterday's events, messages and message events land daily in
  `s3://<exports bucket>/dispatch-exports/<type>/daily-<date>/`. Each has `manifest.json`
  last, so load after it appears: Snowpipe or `COPY ... FROM 's3://…'` in Redshift or
  Snowflake, or a BigQuery transfer.
- **Load test before big events.** Run
  `npm run loadtest -- --devices 1000000 --workers <n>` against a staging database, and
  keep the report in `loadtest-results/`.
