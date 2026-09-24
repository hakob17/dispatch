import { db } from "../db";

export type JobType =
  | "LAUNCH_CAMPAIGN"
  | "LAUNCH_PARTITION" // one contact-id range of a launch, fanned out in parallel
  | "SEND_MESSAGE"
  | "SEND_BATCH" // up to 500 push messages sent through one provider batch call
  | "ENROLL_JOURNEY"
  | "JOURNEY_STEP"
  | "DELIVER_WEBHOOK"
  | "LIVE_ACTIVITY_SEND" // one Live Activity event to ≤500 devices
  | "FEED_POLL" // fetch one content feed
  | "EXPORT_S3";

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  runAt: Date = new Date()
): Promise<string> {
  const job = await db.job.create({ data: { type, payload: payload as object, runAt } });
  return job.id;
}

export async function enqueueMany(
  jobs: { type: JobType; payload: Record<string, unknown>; runAt?: Date }[]
): Promise<number> {
  const now = new Date();
  const res = await db.job.createMany({
    data: jobs.map((j) => ({ type: j.type, payload: j.payload as object, runAt: j.runAt ?? now })),
  });
  return res.count;
}
