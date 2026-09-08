import "dotenv/config";
import { db } from "@/lib/db";
import { claimJobs, completeJob, failJob, reapStuckJobs } from "@/lib/queue/claim";
import { handleLaunchCampaign, completeFinishedCampaigns } from "./handlers/launchCampaign";
import { handleSendMessage, TransientSendError, RescheduleError } from "./handlers/sendMessage";
import { handleEnrollJourney, handleJourneyStep } from "./handlers/journeys";

const POLL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS) || 1000;
const BATCH = Number(process.env.WORKER_BATCH_SIZE) || 25;

let shuttingDown = false;

async function processJob(job: Awaited<ReturnType<typeof claimJobs>>[number]): Promise<void> {
  const payload = job.payload as never;
  try {
    switch (job.type) {
      case "LAUNCH_CAMPAIGN": await handleLaunchCampaign(payload); break;
      case "SEND_MESSAGE": await handleSendMessage(payload); break;
      case "ENROLL_JOURNEY": await handleEnrollJourney(payload); break;
      case "JOURNEY_STEP": await handleJourneyStep(payload); break;
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
    const retryable = err instanceof TransientSendError || !(err instanceof SyntaxError);
    console.error(`[worker] job ${job.id} (${job.type}) failed:`, err);
    await failJob(job, String(err).slice(0, 1000), retryable);
  }
}

let tick = 0;

async function loop(): Promise<void> {
  console.log(`[worker] started — polling every ${POLL_MS}ms, batch ${BATCH}`);
  while (!shuttingDown) {
    try {
      const jobs = await claimJobs(BATCH);
      if (jobs.length) {
        console.log(`[worker] claimed ${jobs.length} job(s)`);
        // Send jobs run concurrently; SES throttling is enforced inside the adapter
        await Promise.all(jobs.map(processJob));
      }
      // Housekeeping every ~30 ticks
      if (++tick % 30 === 0) {
        await reapStuckJobs();
        await completeFinishedCampaigns();
      }
      if (!jobs.length) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (err) {
      console.error("[worker] loop error:", err);
      await new Promise((r) => setTimeout(r, POLL_MS * 5));
    }
  }
  console.log("[worker] stopped");
  process.exit(0);
}

process.on("SIGINT", () => { shuttingDown = true; });
process.on("SIGTERM", () => { shuttingDown = true; });

loop();
