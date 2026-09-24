import "dotenv/config";
import http from "node:http";
import { db, durableWrite } from "@/lib/db";
import { claimJobs, completeJob, failJob, heartbeatJob, reapStuckJobs } from "@/lib/queue/claim";
import { handleLaunchCampaign, handleLaunchPartition, completeFinishedCampaigns } from "./handlers/launchCampaign";
import { handleSendMessage, handleSendBatch, failInterruptedSends, TransientSendError, RescheduleError } from "./handlers/sendMessage";
import { handleEnrollJourney, handleJourneyStep } from "./handlers/journeys";
import { deliverWebhook } from "@/lib/webhooks/events";
import { handleLiveActivitySend } from "@/lib/liveActivities";
import { pollFeed, scheduleFeedPolls } from "@/lib/feeds";
import { handleExportS3 } from "@/lib/export/s3";
import { runRetention } from "@/lib/retention";
import { purgeOldRateLimitBuckets } from "@/lib/rateLimit";
import { emitMetrics, scheduleDailyExport } from "@/lib/metrics";

const POLL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS) || 1000;
const BATCH = Number(process.env.WORKER_BATCH_SIZE) || 25;
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT) || 8081;

// Each concurrent job needs its own connections; warn when the pool can't cover them
const pool = Number(process.env.DB_POOL_SIZE) || Number(new URL(process.env.DATABASE_URL ?? "postgres://x/y").searchParams.get("connection_limit")) || 0;
if (pool && pool < BATCH + 5) {
  console.warn(`[worker] DB pool (${pool}) is small for WORKER_BATCH_SIZE=${BATCH}; set DB_POOL_SIZE ≥ ${BATCH + 5}`);
}

let shuttingDown = false;
let lastLoopAt = Date.now();

async function processJob(job: Awaited<ReturnType<typeof claimJobs>>[number]): Promise<void> {
  const payload = job.payload as never;
  // Keep lockedAt fresh while the job runs so the reaper never hands a
  // long-running job (e.g. a 1M-recipient launch) to a second worker.
  const beat = setInterval(() => heartbeatJob(job.id).catch(() => {}), 60_000);
  try {
    switch (job.type) {
      case "LAUNCH_CAMPAIGN": await handleLaunchCampaign(payload); break;
      case "LAUNCH_PARTITION": await handleLaunchPartition(payload); break;
      case "SEND_MESSAGE": await handleSendMessage(payload); break;
      case "SEND_BATCH": await handleSendBatch(payload); break;
      case "ENROLL_JOURNEY": await handleEnrollJourney(payload); break;
      case "JOURNEY_STEP": await handleJourneyStep(payload); break;
      case "DELIVER_WEBHOOK": await deliverWebhook(payload); break;
      case "LIVE_ACTIVITY_SEND": await handleLiveActivitySend(payload); break;
      case "FEED_POLL": await pollFeed(payload); break;
      case "EXPORT_S3": await handleExportS3(payload); break;
      default:
        await failJob(job, `unknown job type ${job.type}`, false);
        return;
    }
    await completeJob(job.id);
  } catch (err) {
    if (err instanceof RescheduleError) {
      // Not a failure: push the job to a specific time without burning an attempt
      await db.job.update({
        where: { id: job.id },
        data: { status: "PENDING", runAt: err.runAt, lockedAt: null, attempts: { decrement: 1 } },
      });
      return;
    }
    // Programming errors (bad payload, type errors) won't fix themselves on retry
    const retryable = err instanceof TransientSendError || !(err instanceof SyntaxError || err instanceof TypeError);
    console.error(`[worker] job ${job.id} (${job.type}) failed:`, err);
    await durableWrite(() => failJob(job, String(err).slice(0, 1000), retryable));
  } finally {
    clearInterval(beat);
  }
}

let lastRetentionAt = 0;
let lastMetricsAt = 0;

async function housekeeping(): Promise<void> {
  await scheduleFeedPolls();
  await reapStuckJobs();
  await failInterruptedSends();
  await completeFinishedCampaigns();
  if (Date.now() - lastMetricsAt >= 60_000) {
    lastMetricsAt = Date.now();
    await emitMetrics().catch((err) => console.error("[metrics]", err));
  }
  if (Date.now() - lastRetentionAt > 3600_000) {
    lastRetentionAt = Date.now();
    await purgeOldRateLimitBuckets();
    await runRetention();
    await scheduleDailyExport();
  }
}

/**
 * Continuous pool: keep up to WORKER_BATCH_SIZE jobs in flight and claim more
 * as soon as any slot frees up — one slow job (a launch partition) never
 * leaves the other slots idle.
 */
async function loop(): Promise<void> {
  console.log(`[worker] started — up to ${BATCH} concurrent jobs, polling every ${POLL_MS}ms`);
  const inflight = new Set<Promise<void>>();
  let lastHousekeeping = Date.now();
  while (!shuttingDown) {
    lastLoopAt = Date.now();
    try {
      const free = BATCH - inflight.size;
      const jobs = free > 0 ? await claimJobs(free) : [];
      for (const job of jobs) {
        const p: Promise<void> = processJob(job).finally(() => inflight.delete(p));
        inflight.add(p);
      }
      if (Date.now() - lastHousekeeping > 30 * POLL_MS) {
        lastHousekeeping = Date.now();
        await housekeeping();
      }
      if (!jobs.length || inflight.size >= BATCH) {
        // Wake on the first finished job, or after the poll interval
        await Promise.race([new Promise((r) => setTimeout(r, POLL_MS)), ...inflight]);
      }
    } catch (err) {
      console.error("[worker] loop error:", err);
      await new Promise((r) => setTimeout(r, POLL_MS * 5));
    }
  }
  console.log(`[worker] draining ${inflight.size} in-flight job(s)`);
  await Promise.allSettled([...inflight]);
  console.log("[worker] stopped");
  healthServer.close();
  await db.$disconnect();
  process.exit(0);
}

// Health endpoint for the ECS container health check: unhealthy if the loop stalls
const healthServer = http.createServer((_req, res) => {
  const stalledMs = Date.now() - lastLoopAt;
  const ok = stalledMs < 10 * 60_000;
  res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok, stalledMs, shuttingDown }));
});
healthServer.listen(HEALTH_PORT, () => console.log(`[worker] health on :${HEALTH_PORT}`));

// ECS sends SIGTERM on deploy/scale-in: finish the in-flight batch, then exit
process.on("SIGINT", () => { shuttingDown = true; });
process.on("SIGTERM", () => { shuttingDown = true; });

loop();
