import { db } from "@/lib/db";
import { enqueue, enqueueMany } from "@/lib/queue/enqueue";
import { filtersToWhere, SegmentFilter } from "@/lib/segments/resolve";
import { continueRun, sendStep } from "@/lib/journeys";

/**
 * Enrol all matching contacts into an ACTIVE journey and schedule their first step.
 * Event-triggered journeys enrol one contact at a time as the event arrives (lib/journeys),
 * so activation doesn't bulk-enrol them.
 */
export async function handleEnrollJourney(payload: { journeyId: string }): Promise<void> {
  const journey = await db.journey.findUnique({
    where: { id: payload.journeyId },
    include: { segment: true, steps: { orderBy: { order: "asc" } } },
  });
  if (!journey || journey.status !== "ACTIVE" || !journey.steps.length || journey.triggerEvent) return;

  const where = journey.segment ? filtersToWhere(journey.segment.filters as unknown as SegmentFilter[]) : {};

  let cursor: string | undefined;
  for (;;) {
    const contacts = await db.contact.findMany({
      // Keyset paging: enrolled contacts drop out of this filter, so cursor+skip would skip real ones
      where: { AND: [where, { journeyRuns: { none: { journeyId: journey.id } } }, ...(cursor ? [{ id: { gt: cursor } }] : [])] },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (!contacts.length) break;
    cursor = contacts[contacts.length - 1].id;

    await db.journeyRun.createMany({
      data: contacts.map((c) => ({ journeyId: journey.id, contactId: c.id, currentKey: journey.entryKey })),
      skipDuplicates: true,
    });
    await enqueueMany(
      contacts.map((c) =>
        journey.entryKey
          ? { type: "JOURNEY_STEP" as const, payload: { journeyId: journey.id, contactId: c.id, key: journey.entryKey } }
          : {
              type: "JOURNEY_STEP" as const,
              payload: { journeyId: journey.id, contactId: c.id, stepOrder: journey.steps[0].order },
              runAt: new Date(Date.now() + journey.steps[0].delayMinutes * 60_000),
            }
      )
    );
    if (contacts.length < 500) break;
  }
}

/** One journey step for one contact: branching journeys walk the graph, linear ones advance by order. */
export async function handleJourneyStep(payload: {
  journeyId: string;
  contactId: string;
  stepOrder?: number;
  key?: string;
  timeout?: boolean;
}): Promise<void> {
  if (payload.key) return continueRun({ journeyId: payload.journeyId, contactId: payload.contactId, key: payload.key, timeout: payload.timeout });

  const journey = await db.journey.findUnique({
    where: { id: payload.journeyId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!journey || journey.status !== "ACTIVE") return; // paused/archived journeys stop advancing

  const run = await db.journeyRun.findUnique({
    where: { journeyId_contactId: { journeyId: payload.journeyId, contactId: payload.contactId } },
  });
  if (!run || run.completedAt) return;
  if (run.currentStep !== payload.stepOrder) return; // stale/duplicate job

  const step = journey.steps.find((s) => s.order === payload.stepOrder);
  if (!step) {
    await db.journeyRun.update({ where: { id: run.id }, data: { completedAt: new Date(), exitReason: "completed" } });
    return;
  }
  await sendStep(step, payload.contactId);

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
    await db.journeyRun.update({ where: { id: run.id }, data: { completedAt: new Date(), exitReason: "completed" } });
  }
}
