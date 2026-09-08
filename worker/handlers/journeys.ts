import { Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue, enqueueMany } from "@/lib/queue/enqueue";
import { filtersToWhere, SegmentFilter } from "@/lib/segments/resolve";

const PUSH_CHANNELS: Channel[] = ["WEB_PUSH", "FCM", "APNS"];

/** Enroll all matching contacts into an ACTIVE journey and schedule step 0. */
export async function handleEnrollJourney(payload: { journeyId: string }): Promise<void> {
  const journey = await db.journey.findUnique({
    where: { id: payload.journeyId },
    include: { segment: true, steps: { orderBy: { order: "asc" } } },
  });
  if (!journey || journey.status !== "ACTIVE" || !journey.steps.length) return;

  const where = journey.segment
    ? filtersToWhere(journey.segment.filters as unknown as SegmentFilter[])
    : {};

  let cursor: string | undefined;
  for (;;) {
    const contacts = await db.contact.findMany({
      where: { AND: [where, { journeyRuns: { none: { journeyId: journey.id } } }] },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!contacts.length) break;
    cursor = contacts[contacts.length - 1].id;

    await db.journeyRun.createMany({
      data: contacts.map((c) => ({ journeyId: journey.id, contactId: c.id })),
      skipDuplicates: true,
    });
    const firstDelay = journey.steps[0].delayMinutes * 60_000;
    await enqueueMany(
      contacts.map((c) => ({
        type: "JOURNEY_STEP" as const,
        payload: { journeyId: journey.id, contactId: c.id, stepOrder: journey.steps[0].order },
        runAt: new Date(Date.now() + firstDelay),
      }))
    );
    if (contacts.length < 500) break;
  }
}

/** Execute one journey step for one contact: create+queue the message, schedule the next step. */
export async function handleJourneyStep(payload: {
  journeyId: string;
  contactId: string;
  stepOrder: number;
}): Promise<void> {
  const journey = await db.journey.findUnique({
    where: { id: payload.journeyId },
    include: { steps: { orderBy: { order: "asc" }, include: { template: true } } },
  });
  if (!journey) return;
  if (journey.status !== "ACTIVE") return; // paused/archived journeys stop advancing

  const run = await db.journeyRun.findUnique({
    where: { journeyId_contactId: { journeyId: payload.journeyId, contactId: payload.contactId } },
  });
  if (!run || run.completedAt) return;
  if (run.currentStep !== payload.stepOrder) return; // stale/duplicate job

  const step = journey.steps.find((s) => s.order === payload.stepOrder);
  if (!step) {
    await db.journeyRun.update({ where: { id: run.id }, data: { completedAt: new Date() } });
    return;
  }

  // Create the message(s) for this step
  if (PUSH_CHANNELS.includes(step.channel)) {
    const subs = await db.pushSubscription.findMany({
      where: { contactId: payload.contactId, channel: step.channel, isActive: true },
      select: { id: true },
    });
    for (const sub of subs) {
      const msg = await db.message.create({
        data: {
          journeyStepId: step.id,
          contactId: payload.contactId,
          pushSubscriptionId: sub.id,
          channel: step.channel,
          status: "QUEUED",
        },
      });
      await enqueue("SEND_MESSAGE", { messageId: msg.id });
    }
  } else {
    const msg = await db.message.create({
      data: {
        journeyStepId: step.id,
        contactId: payload.contactId,
        channel: step.channel,
        status: "QUEUED",
      },
    });
    await enqueue("SEND_MESSAGE", { messageId: msg.id });
  }

  // Advance to the next step or complete
  const next = journey.steps.find((s) => s.order > step.order);
  if (next) {
    await db.journeyRun.update({ where: { id: run.id }, data: { currentStep: next.order } });
    await enqueue(
      "JOURNEY_STEP",
      { journeyId: journey.id, contactId: payload.contactId, stepOrder: next.order },
      new Date(Date.now() + next.delayMinutes * 60_000)
    );
  } else {
    await db.journeyRun.update({ where: { id: run.id }, data: { completedAt: new Date() } });
  }
}
