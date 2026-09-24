import { db } from "./db";
import { getSetting, setSetting } from "./settings";
import { enqueue } from "./queue/enqueue";
import { exportBucket } from "./export/s3";
import { dailyExportEnabled } from "./warehouse";

/**
 * Operational metrics as CloudWatch Embedded Metric Format: one JSON log line
 * a minute on stdout, which CloudWatch Logs turns into metrics (namespace
 * "Dispatch", dimension Environment) — no SDK, no extra IAM. Alarms and the
 * worker's queue-depth autoscaling in infra/aws read these.
 * Enabled with METRICS_EMF=true (set by Terraform).
 */
export async function collectMetrics(): Promise<Record<string, number>> {
  const now = new Date();
  const [queue] = await db.$queryRaw<{ depth: bigint; oldest: number | null }[]>`
    SELECT count(*) AS depth,
           extract(epoch FROM (now() AT TIME ZONE 'UTC') - min("runAt")) AS oldest
    FROM "Job" WHERE status = 'PENDING' AND "runAt" <= (now() AT TIME ZONE 'UTC')`;
  const since = new Date(now.getTime() - 5 * 60_000);
  const [failedJobs, sent, failedMessages, failingWebhooks, failingFeeds, running] = await Promise.all([
    db.job.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    db.message.count({ where: { sentAt: { gte: since } } }),
    db.message.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
    db.webhookEndpoint.count({ where: { isActive: true, failureCount: { gte: 3 } } }),
    db.contentFeed.count({ where: { isActive: true, lastError: { not: null } } }),
    db.job.count({ where: { status: "RUNNING" } }),
  ]);
  return {
    QueueDepth: Number(queue?.depth ?? 0),
    OldestPendingJobAgeSeconds: Math.max(0, Math.round(Number(queue?.oldest ?? 0))),
    RunningJobs: running,
    FailedJobs5m: failedJobs,
    MessagesSent5m: sent,
    MessagesFailed5m: failedMessages,
    WebhookEndpointsFailing: failingWebhooks,
    FeedsFailing: failingFeeds,
  };
}

export async function emitMetrics(): Promise<void> {
  if (process.env.METRICS_EMF !== "true") return;
  const m = await collectMetrics();
  const env = process.env.DISPATCH_ENV || "dev";
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "Dispatch",
            Dimensions: [["Environment"]],
            Metrics: Object.keys(m).map((Name) => ({ Name, Unit: Name.endsWith("Seconds") ? "Seconds" : "Count" })),
          },
        ],
      },
      Environment: env,
      ...m,
    })
  );
}

/**
 * Daily warehouse export (Settings → Data warehouse, or EXPORT_S3_DAILY=true): once per UTC day, yesterday's
 * events, messages and message events go to S3 as NDJSON — load them with
 * Snowpipe, Redshift COPY or a BigQuery transfer.
 */
export async function scheduleDailyExport(): Promise<void> {
  if (!exportBucket() || !(await dailyExportEnabled())) return;
  const today = new Date().toISOString().slice(0, 10);
  const last = await getSetting<{ date: string }>("dailyExport");
  if (last?.date === today) return;
  const until = new Date(`${today}T00:00:00.000Z`);
  const since = new Date(until.getTime() - 86400_000);
  const day = since.toISOString().slice(0, 10);
  for (const type of ["events", "messages", "message_events"] as const) {
    await enqueue("EXPORT_S3", { exportId: `daily-${day}`, type, since: since.toISOString(), until: until.toISOString() });
  }
  await setSetting("dailyExport", { date: today });
  console.log(`[export] queued daily export for ${day}`);
}
