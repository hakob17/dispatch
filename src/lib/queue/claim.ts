import { Job, JobStatus } from "@prisma/client";
import { db } from "../db";

/** Atomically claim a batch of due jobs using FOR UPDATE SKIP LOCKED. Safe with multiple workers. */
export async function claimJobs(batchSize: number): Promise<Job[]> {
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE status = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

/** Return stuck RUNNING jobs (worker died mid-job) to PENDING after 5 minutes. */
export async function reapStuckJobs(): Promise<number> {
  const res = await db.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    data: { status: "PENDING", lockedAt: null },
  });
  return res.count;
}

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000];

export async function completeJob(id: string): Promise<void> {
  await db.job.update({ where: { id }, data: { status: "DONE" } });
}

/** Mark failed; reschedule with backoff if attempts remain and the error is retryable. */
export async function failJob(job: Job, error: string, retryable: boolean): Promise<void> {
  if (retryable && job.attempts < job.maxAttempts) {
    const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)];
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "PENDING" satisfies JobStatus,
        lastError: error,
        lockedAt: null,
        runAt: new Date(Date.now() + delay),
      },
    });
  } else {
    await db.job.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: error },
    });
  }
}
