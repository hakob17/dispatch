import { db } from "../db";

export type JobType = "LAUNCH_CAMPAIGN" | "SEND_MESSAGE" | "ENROLL_JOURNEY" | "JOURNEY_STEP";

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
