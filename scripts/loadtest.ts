/**
 * Breaking-news broadcast load test.
 *
 *   npx tsx scripts/loadtest.ts --devices 1000000 --workers 4 [--latency 400] [--keep]
 *
 * Seeds N synthetic contacts with one FCM token each, starts K worker
 * processes against a mock provider (PUSH_PROVIDER_MODE=mock, which answers
 * each 500-message FCM call after --latency ms), launches a broadcast
 * campaign, and measures how long Dispatch takes from the send command to
 * handing every message to the provider:
 *
 *   fan-out time            launch → last Message row created
 *   hand-off p50/p95/p99    launch → message.sentAt, across all messages
 *   sustained throughput    messages / (last hand-off − first hand-off)
 *
 * Results go to loadtest-results/<run>.json and .md. Synthetic data is
 * deleted afterwards unless --keep. Never point this at production: it needs
 * a database you can fill with N rows.
 */
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../src/lib/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const DEVICES = Number(arg("devices", "100000"));
const WORKERS = Number(arg("workers", "4"));
const LATENCY = arg("latency", "400");
const BATCH = arg("batch", "25");
const KEEP = process.argv.includes("--keep");
const TIMEOUT_MS = Number(arg("timeout", String(30 * 60_000)));
const RUN = `lt${Date.now().toString(36)}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(`[loadtest ${RUN}]`, ...a);

async function seed(): Promise<void> {
  const chunk = 100_000;
  const started = Date.now();
  for (let a = 1; a <= DEVICES; a += chunk) {
    const b = Math.min(DEVICES, a + chunk - 1);
    await db.$executeRawUnsafe(
      `INSERT INTO "Contact" (id, "externalId", attributes, "createdAt", "updatedAt")
       SELECT '${RUN}_' || lpad(g::text, 8, '0'), '${RUN}-' || g, jsonb_build_object('loadtest', '${RUN}'),
              now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC'
       FROM generate_series(${a}, ${b}) g`
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "PushSubscription" (id, "contactId", channel, endpoint, platform, "isActive", "createdAt")
       SELECT '${RUN}s_' || lpad(g::text, 8, '0'), '${RUN}_' || lpad(g::text, 8, '0'), 'FCM', 'mock-token-${RUN}-' || g,
              CASE WHEN g % 2 = 0 THEN 'ios' ELSE 'android' END, true, now() AT TIME ZONE 'UTC'
       FROM generate_series(${a}, ${b}) g`
    );
    log(`seeded ${b.toLocaleString()} / ${DEVICES.toLocaleString()}`);
  }
  await db.$executeRawUnsafe(`ANALYZE "Contact"; ANALYZE "PushSubscription"`).catch(() => {});
  log(`seed done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function startWorkers(poolPerWorker: number): ChildProcess[] {
  return Array.from({ length: WORKERS }, (_, i) => {
    // tsx directly (not via npx) so SIGTERM reaches the worker and it drains cleanly
    const p = spawn("node_modules/.bin/tsx", ["worker/index.ts"], {
      env: {
        ...process.env,
        PUSH_PROVIDER_MODE: "mock",
        MOCK_PUSH_BATCH_LATENCY_MS: LATENCY,
        WORKER_BATCH_SIZE: BATCH,
        DB_POOL_SIZE: String(poolPerWorker),
        DB_POOL_TIMEOUT: "30",
        WORKER_POLL_INTERVAL_MS: "200",
        WORKER_HEALTH_PORT: String(18100 + i),
        WORKER_COUNT: String(WORKERS),
        LAUNCH_TIMING: process.env.LAUNCH_TIMING ?? "",
      },
      stdio: ["ignore", process.env.LAUNCH_TIMING ? "inherit" : "ignore", "inherit"],
    });
    return p;
  });
}

async function main() {
  log(`devices=${DEVICES.toLocaleString()} workers=${WORKERS} provider latency=${LATENCY}ms/500 msgs`);
  await seed();

  const template = await db.messageTemplate.create({
    data: {
      name: `loadtest ${RUN}`,
      channel: "FCM",
      pushTitle: "Breaking: load test",
      pushBody: "Hello {{attributes.loadtest}}",
      pushUrl: "myapp://story/loadtest",
      pushPriority: "HIGH",
      pushCollapseKey: RUN,
      pushTtlSeconds: 900,
    },
  });
  const segment = await db.segment.create({
    data: { name: `loadtest ${RUN}`, filters: [{ field: "attributes.loadtest", op: "eq", value: RUN }] },
  });
  const campaign = await db.campaign.create({
    data: {
      name: `loadtest ${RUN}`,
      channel: "FCM",
      segmentId: segment.id,
      bypassDeliveryRules: true,
      variants: { create: [{ templateId: template.id, weight: 100 }] },
    },
  });

  // Fit every worker's pool inside the database's connection limit
  const [{ max_connections }] = await db.$queryRawUnsafe<{ max_connections: string }[]>("SHOW max_connections");
  const poolPerWorker = Math.max(5, Math.min(Number(BATCH) + 10, Math.floor((Number(max_connections) - 25) / WORKERS)));
  const activeWebhooks = await db.webhookEndpoint.count({ where: { isActive: true } });
  if (activeWebhooks) log(`note: ${activeWebhooks} active event webhook(s) will also receive ${DEVICES.toLocaleString()}+ events`);
  log(`db max_connections=${max_connections}, pool per worker=${poolPerWorker}`);
  const workers = startWorkers(poolPerWorker);
  await sleep(6000); // let workers boot (tsx compile)

  const t0 = new Date();
  await db.campaign.update({ where: { id: campaign.id }, data: { status: "SCHEDULED", scheduledAt: t0 } });
  await db.job.create({ data: { type: "LAUNCH_CAMPAIGN", payload: { campaignId: campaign.id }, runAt: t0 } });
  log("launched");

  let done = 0;
  let lastProgress = { done: -1, at: Date.now() };
  while (Date.now() - t0.getTime() < TIMEOUT_MS) {
    await sleep(2000);
    const rows = await db.message.groupBy({ by: ["status"], where: { campaignId: campaign.id }, _count: { _all: true } });
    const by = Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    done = (by.SENT ?? 0) + (by.DELIVERED ?? 0) + (by.FAILED ?? 0);
    const elapsed = ((Date.now() - t0.getTime()) / 1000).toFixed(0);
    log(`${elapsed}s  created=${Object.values(by).reduce((s, n) => s + n, 0).toLocaleString()}  handed-off=${done.toLocaleString()}`);
    if (done >= DEVICES) break;
    if (done !== lastProgress.done) lastProgress = { done, at: Date.now() };
    else if (Date.now() - lastProgress.at > 90_000) {
      log("no progress for 90s — stopping (report will show completed=false)");
      break;
    }
  }

  workers.forEach((w) => w.kill("SIGTERM"));

  const [stats] = await db.$queryRawUnsafe<
    { p50: number; p95: number; p99: number; first: number; last: number; fanout: number; sent: bigint; failed: bigint }[]
  >(
    `SELECT
       percentile_cont(0.50) WITHIN GROUP (ORDER BY s) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY s) AS p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY s) AS p99,
       min(s) AS first, max(s) AS last,
       (SELECT extract(epoch FROM max("createdAt") - $2::timestamp) FROM "Message" WHERE "campaignId" = $1) AS fanout,
       count(*) FILTER (WHERE status IN ('SENT','DELIVERED')) AS sent,
       (SELECT count(*) FROM "Message" WHERE "campaignId" = $1 AND status = 'FAILED') AS failed
     FROM (SELECT extract(epoch FROM "sentAt" - $2::timestamp) AS s, status FROM "Message"
           WHERE "campaignId" = $1 AND "sentAt" IS NOT NULL) x`,
    campaign.id,
    t0.toISOString().replace("T", " ").replace("Z", "")
  );

  const sent = Number(stats.sent);
  const spread = Math.max(0.001, stats.last - stats.first);
  const report = {
    run: RUN,
    date: new Date().toISOString(),
    devices: DEVICES,
    workers: WORKERS,
    workerBatchSize: Number(BATCH),
    dbPoolPerWorker: poolPerWorker,
    providerLatencyMsPer500: Number(LATENCY),
    completed: done >= DEVICES,
    handedOff: sent,
    failed: Number(stats.failed),
    seconds: {
      fanOut: round(stats.fanout),
      firstHandOff: round(stats.first),
      p50: round(stats.p50),
      p95: round(stats.p95),
      p99: round(stats.p99),
      allHandedOff: round(stats.last),
    },
    throughputPerMinute: Math.round((sent / spread) * 60),
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      database: (process.env.DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//***@"),
    },
  };

  await mkdir("loadtest-results", { recursive: true });
  await writeFile(`loadtest-results/${RUN}.json`, JSON.stringify(report, null, 2));
  await writeFile(
    `loadtest-results/${RUN}.md`,
    `# Broadcast load test ${RUN}\n\n` +
      `${DEVICES.toLocaleString()} devices · ${WORKERS} workers · mock provider ${LATENCY} ms per 500-message call\n\n` +
      `| Metric | Seconds from send command |\n|---|---|\n` +
      `| Fan-out complete (all messages created) | ${report.seconds.fanOut} |\n` +
      `| First hand-off | ${report.seconds.firstHandOff} |\n` +
      `| p50 hand-off | ${report.seconds.p50} |\n| p95 hand-off | ${report.seconds.p95} |\n| p99 hand-off | ${report.seconds.p99} |\n` +
      `| 100% handed off | ${report.seconds.allHandedOff} |\n\n` +
      `Sustained throughput: **${report.throughputPerMinute.toLocaleString()} messages/minute**. ` +
      `Handed off ${sent.toLocaleString()}, failed ${report.failed.toLocaleString()}.\n\n` +
      `Environment: ${report.environment.platform}, Node ${report.environment.node}.\n`
  );
  log("report", JSON.stringify(report.seconds), `${report.throughputPerMinute.toLocaleString()}/min`);

  if (!KEEP) {
    log("cleaning up");
    await db.job.deleteMany({ where: { type: { in: ["SEND_BATCH", "LAUNCH_CAMPAIGN"] }, status: "DONE", createdAt: { gte: t0 } } });
    await db.message.deleteMany({ where: { campaignId: campaign.id } });
    await db.campaign.delete({ where: { id: campaign.id } });
    await db.segment.delete({ where: { id: segment.id } });
    await db.messageTemplate.delete({ where: { id: template.id } });
    await db.$executeRawUnsafe(`DELETE FROM "Contact" WHERE id LIKE '${RUN}\\_%'`);
  }
  await db.$disconnect();
}

const round = (n: number) => Math.round(Number(n) * 100) / 100;

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
