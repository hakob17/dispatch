import type { Channel, Journey, JourneyRun, JourneyStep, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "./db";
import { enqueue } from "./queue/enqueue";
import { campaignPushChannels } from "./campaignFanOut";
import { filtersToWhere, type SegmentFilter } from "./segments/resolve";
import { isSubscribed } from "./subscriptions";

/**
 * Branching journeys (Canvas-style). A journey is a graph of nodes keyed by `key`; a contact's
 * JourneyRun walks it. Node types and their outlets (`next`):
 *
 *   MESSAGE    → default      send a template on a channel
 *   DELAY      → default      wait N minutes
 *   CONDITION  → yes | no     rules on the contact (attributes, segment, events, engagement, …)
 *   RANDOM     → branches[i]  weighted A/B/n split (stable per contact)
 *   WAIT_EVENT → event | timeout   resume when the contact performs an event, or after a timeout
 *   EXIT                       leave the journey
 *
 * Journeys without an entryKey are the older linear kind (MESSAGE steps in `order`, each after
 * `delayMinutes`) and keep working unchanged.
 */

// ------------------------------------------------------------------ schema

const ruleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attribute"), field: z.string().min(1), op: z.enum(["eq", "neq", "contains", "exists", "gt", "lt"]), value: z.unknown().optional() }),
  z.object({ type: z.literal("segment"), segmentId: z.string().min(1) }),
  /** performed the event since entering the journey, or within the last N hours */
  z.object({ type: z.literal("event"), name: z.string().min(1), withinHours: z.number().int().min(1).optional() }),
  /** opened / clicked the message sent by an earlier MESSAGE node */
  z.object({ type: z.literal("engaged"), nodeKey: z.string().min(1), action: z.enum(["opened", "clicked"]) }),
  z.object({ type: z.literal("subscribed"), groupId: z.string().min(1) }),
  z.object({ type: z.literal("reachable"), channel: z.enum(["EMAIL", "FCM", "APNS", "WEB_PUSH", "ANY_PUSH"]) }),
]);
export type Rule = z.infer<typeof ruleSchema>;

const key = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "letters, digits, _ and -");
const outlet = key.nullable().optional();

export const nodeSchema = z.discriminatedUnion("type", [
  z.object({
    key, type: z.literal("MESSAGE"), label: z.string().max(80).optional(),
    channel: z.enum(["EMAIL", "WEB_PUSH", "FCM", "APNS", "WEBHOOK", "IN_APP", "CONTENT_CARD", "SMS", "WHATSAPP"]),
    templateId: z.string().min(1),
    config: z.object({ allPushPlatforms: z.boolean().optional() }).optional(),
    next: z.object({ default: outlet }).default({}),
  }),
  z.object({
    key, type: z.literal("DELAY"), label: z.string().max(80).optional(),
    config: z.object({ minutes: z.number().int().min(1).max(60 * 24 * 365) }),
    next: z.object({ default: outlet }).default({}),
  }),
  z.object({
    key, type: z.literal("CONDITION"), label: z.string().max(80).optional(),
    config: z.object({ match: z.enum(["all", "any"]).default("all"), rules: z.array(ruleSchema).min(1).max(20) }),
    next: z.object({ yes: outlet, no: outlet }),
  }),
  z.object({
    key, type: z.literal("RANDOM"), label: z.string().max(80).optional(),
    config: z.object({ weights: z.array(z.number().int().min(0).max(100)).min(2).max(5) }),
    next: z.object({ branches: z.array(outlet) }),
  }),
  z.object({
    key, type: z.literal("WAIT_EVENT"), label: z.string().max(80).optional(),
    config: z.object({ event: z.string().min(1).max(255), timeoutMinutes: z.number().int().min(1).max(60 * 24 * 90) }),
    next: z.object({ event: outlet, timeout: outlet }),
  }),
  z.object({ key, type: z.literal("EXIT"), label: z.string().max(80).optional(), next: z.object({}).default({}) }),
]);
export type JourneyNode = z.infer<typeof nodeSchema>;

/** Structural checks zod can't express: unique keys, known targets, weights. Returns problems. */
export function validateGraph(nodes: JourneyNode[], entryKey: string): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const n of nodes) {
    if (keys.has(n.key)) problems.push(`duplicate node key "${n.key}"`);
    keys.add(n.key);
  }
  if (!keys.has(entryKey)) problems.push(`entry node "${entryKey}" doesn't exist`);
  for (const n of nodes) {
    for (const target of outlets(n)) if (target && !keys.has(target)) problems.push(`"${n.key}" points to missing node "${target}"`);
    if (n.type === "RANDOM") {
      if (n.config.weights.length !== n.next.branches.length) problems.push(`"${n.key}": one weight per branch`);
      if (n.config.weights.reduce((a, b) => a + b, 0) !== 100) problems.push(`"${n.key}": weights must add up to 100`);
    }
  }
  return problems;
}

function outlets(n: JourneyNode): (string | null | undefined)[] {
  switch (n.type) {
    case "CONDITION": return [n.next.yes, n.next.no];
    case "RANDOM": return n.next.branches;
    case "WAIT_EVENT": return [n.next.event, n.next.timeout];
    case "EXIT": return [];
    default: return [n.next.default];
  }
}

/** Nodes → JourneyStep rows (order = position, so message reporting keeps its step id). */
export function nodesToSteps(nodes: JourneyNode[]): Omit<Prisma.JourneyStepCreateManyInput, "journeyId">[] {
  return nodes.map((n, order) => ({
    order,
    key: n.key,
    type: n.type,
    label: n.label ?? null,
    channel: n.type === "MESSAGE" ? (n.channel as Channel) : null,
    templateId: n.type === "MESSAGE" ? n.templateId : null,
    config: ("config" in n && n.config ? n.config : undefined) as Prisma.InputJsonValue | undefined,
    next: n.next as Prisma.InputJsonValue,
  }));
}

// ------------------------------------------------------------ API bodies

const linearStep = z.object({
  delayMinutes: z.number().int().min(0),
  channel: z.enum(["EMAIL", "WEB_PUSH", "FCM", "APNS", "WEBHOOK", "IN_APP", "CONTENT_CARD", "SMS", "WHATSAPP"]),
  templateId: z.string(),
});

/** Linear (`steps`) or branching (`nodes` + `entryKey`) journeys. */
export const journeySchema = z
  .object({
    name: z.string().min(1),
    segmentId: z.string().nullable().optional(),
    triggerEvent: z.string().max(255).nullable().optional(),
    exitEvent: z.string().max(255).nullable().optional(),
    steps: z.array(linearStep).min(1).optional(),
    nodes: z.array(nodeSchema).min(1).max(100).optional(),
    entryKey: z.string().optional(),
  })
  .refine((j) => !!j.steps !== !!j.nodes, "send either steps (linear) or nodes (branching)")
  .refine((j) => !j.nodes || !!j.entryKey, "entryKey is required with nodes");

export type JourneyBody = z.infer<typeof journeySchema>;

/** Validated body → the JourneyStep rows to store, or a 400. */
export async function journeyStepsFrom(body: JourneyBody) {
  const templateIds = [...new Set((body.nodes ?? body.steps ?? []).flatMap((n) => ("templateId" in n && n.templateId ? [n.templateId] : [])))];
  const found = await db.messageTemplate.count({ where: { id: { in: templateIds } } });
  if (found !== templateIds.length) return { error: NextResponse.json({ error: "a message step uses a template that no longer exists" }, { status: 400 }) };
  if (body.nodes) {
    const problems = validateGraph(body.nodes, body.entryKey!);
    if (problems.length) return { error: NextResponse.json({ error: problems.join("; ") }, { status: 400 }) };
    return { steps: nodesToSteps(body.nodes), entryKey: body.entryKey! };
  }
  return { steps: body.steps!.map((s, order) => ({ ...s, order })), entryKey: null };
}

// --------------------------------------------------------------- execution

type Step = JourneyStep;
type Next = { default?: string | null; yes?: string | null; no?: string | null; branches?: (string | null)[]; event?: string | null; timeout?: string | null };
const MAX_HOPS = 50; // a cycle without a DELAY/WAIT must not spin forever

/** Start a contact at the journey's first node (branching) — call after creating the run. */
export async function startRun(journey: Journey, run: JourneyRun, firstDelayMs = 0): Promise<void> {
  if (!journey.entryKey) return;
  await db.journeyRun.update({ where: { id: run.id }, data: { currentKey: journey.entryKey } });
  await enqueue("JOURNEY_STEP", { journeyId: journey.id, contactId: run.contactId, key: journey.entryKey }, firstDelayMs ? new Date(Date.now() + firstDelayMs) : undefined);
}

/** Worker: continue a branching run from `key` (or take a WAIT_EVENT's timeout branch). */
export async function continueRun(payload: { journeyId: string; contactId: string; key: string; timeout?: boolean }): Promise<void> {
  const journey = await db.journey.findUnique({ where: { id: payload.journeyId }, include: { steps: true } });
  if (!journey || journey.status !== "ACTIVE") return; // paused/archived journeys stop advancing
  const run = await db.journeyRun.findUnique({ where: { journeyId_contactId: { journeyId: journey.id, contactId: payload.contactId } } });
  if (!run || run.completedAt || run.currentKey !== payload.key) return; // finished, or a stale/duplicate job
  const byKey = new Map(journey.steps.filter((s) => s.key).map((s) => [s.key!, s]));

  // Claim the step: a duplicate job (or an event resuming the same WAIT) finds currentKey changed
  const { count } = await db.journeyRun.updateMany({
    where: { id: run.id, completedAt: null, currentKey: payload.key, waitingEvent: payload.timeout ? { not: null } : null },
    data: { currentKey: null, waitingEvent: null, waitUntil: null },
  });
  if (!count) return;

  let key: string | null | undefined = payload.key;
  if (payload.timeout) {
    const node = byKey.get(payload.key);
    if (!node || node.type !== "WAIT_EVENT") return;
    await visit(journey.id, run.id, node.key!, "timeout");
    key = (node.next as Next).timeout;
  }
  await walk(journey, run, byKey, key);
}

async function walk(journey: Journey, run: JourneyRun, byKey: Map<string, Step>, start: string | null | undefined): Promise<void> {
  let key = start;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const node = key ? byKey.get(key) : undefined;
    if (!node) return complete(run.id, "completed");
    const next = (node.next ?? {}) as Next;
    const config = (node.config ?? {}) as Record<string, unknown>;
    const branchVisit = (branch?: string) => visit(journey.id, run.id, node.key!, branch);

    switch (node.type) {
      case "MESSAGE":
        await branchVisit();
        await sendStep(node, run.contactId, config.allPushPlatforms === true);
        key = next.default;
        break;
      case "DELAY": {
        await branchVisit();
        const target = next.default;
        if (!target) return complete(run.id, "completed");
        await db.journeyRun.update({ where: { id: run.id }, data: { currentKey: target } });
        await enqueue("JOURNEY_STEP", { journeyId: journey.id, contactId: run.contactId, key: target }, new Date(Date.now() + Number(config.minutes ?? 0) * 60_000));
        return;
      }
      case "CONDITION": {
        const yes = await evaluate(config as { match?: "all" | "any"; rules: Rule[] }, run, journey.id);
        await branchVisit(yes ? "yes" : "no");
        key = yes ? next.yes : next.no;
        break;
      }
      case "RANDOM": {
        const weights = (config.weights as number[]) ?? [];
        const i = pickBranch(`${run.id}:${node.key}`, weights);
        await branchVisit(String(i));
        key = next.branches?.[i];
        break;
      }
      case "WAIT_EVENT": {
        await branchVisit();
        const until = new Date(Date.now() + Number(config.timeoutMinutes ?? 60) * 60_000);
        await db.journeyRun.update({ where: { id: run.id }, data: { currentKey: node.key, waitingEvent: String(config.event), waitUntil: until } });
        await enqueue("JOURNEY_STEP", { journeyId: journey.id, contactId: run.contactId, key: node.key!, timeout: true }, until);
        return;
      }
      case "EXIT":
        await branchVisit();
        return complete(run.id, "exit_node");
      default:
        return complete(run.id, "completed");
    }
  }
  console.warn(`[journeys] run ${run.id} hit ${MAX_HOPS} steps without a delay — stopped`);
  await complete(run.id, "loop_guard");
}

async function complete(runId: string, reason: string) {
  await db.journeyRun.update({ where: { id: runId }, data: { completedAt: new Date(), exitReason: reason, waitingEvent: null, waitUntil: null } });
}

async function visit(journeyId: string, runId: string, nodeKey: string, branch?: string) {
  await db.journeyVisit.create({ data: { journeyId, runId, nodeKey, branch: branch ?? null } });
}

/** Deterministic weighted pick: the same contact always lands in the same branch. */
export function pickBranch(seed: string, weights: number[]): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let r = ((h >>> 0) % 10_000) / 10_000 * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Create + queue the step's message(s): one per active device for push. */
export async function sendStep(step: Pick<Step, "id" | "channel">, contactId: string, allPushPlatforms = false): Promise<number> {
  if (!step.channel) return 0;
  const pushChannels = campaignPushChannels({ channel: step.channel, allPushPlatforms });
  if (pushChannels.length) {
    const subs = await db.pushSubscription.findMany({ where: { contactId, channel: { in: pushChannels }, isActive: true }, select: { id: true, channel: true } });
    for (const sub of subs) {
      const msg = await db.message.create({ data: { journeyStepId: step.id, contactId, pushSubscriptionId: sub.id, channel: sub.channel, status: "QUEUED" } });
      await enqueue("SEND_MESSAGE", { messageId: msg.id });
    }
    return subs.length;
  }
  const msg = await db.message.create({ data: { journeyStepId: step.id, contactId, channel: step.channel, status: "QUEUED" } });
  await enqueue("SEND_MESSAGE", { messageId: msg.id });
  return 1;
}

// -------------------------------------------------------------- conditions

export async function evaluate(cfg: { match?: "all" | "any"; rules: Rule[] }, run: Pick<JourneyRun, "id" | "contactId" | "createdAt">, journeyId: string): Promise<boolean> {
  // Short-circuits: "all" stops at the first miss, "any" at the first hit
  for (const rule of cfg.rules) {
    const ok = await evaluateRule(rule, run, journeyId);
    if (cfg.match === "any" && ok) return true;
    if (cfg.match !== "any" && !ok) return false;
  }
  return cfg.match !== "any";
}

async function evaluateRule(rule: Rule, run: Pick<JourneyRun, "contactId" | "createdAt">, journeyId: string): Promise<boolean> {
  const contactId = run.contactId;
  switch (rule.type) {
    case "attribute":
      return (await db.contact.count({ where: { AND: [{ id: contactId }, filtersToWhere([rule as unknown as SegmentFilter])] } })) > 0;
    case "segment": {
      const seg = await db.segment.findUnique({ where: { id: rule.segmentId } });
      if (!seg) return false;
      return (await db.contact.count({ where: { AND: [{ id: contactId }, filtersToWhere(seg.filters as unknown as SegmentFilter[])] } })) > 0;
    }
    case "event": {
      const since = rule.withinHours ? new Date(Date.now() - rule.withinHours * 3600_000) : run.createdAt;
      return (await db.contactEvent.count({ where: { contactId, name: rule.name, createdAt: { gte: since } } })) > 0;
    }
    case "engaged": {
      const step = await db.journeyStep.findFirst({ where: { journeyId, key: rule.nodeKey }, select: { id: true } });
      if (!step) return false;
      const field = rule.action === "opened" ? "openedAt" : "clickedAt";
      return (await db.message.count({ where: { journeyStepId: step.id, contactId, [field]: { not: null } } })) > 0;
    }
    case "subscribed": {
      const [group, state] = await Promise.all([
        db.subscriptionGroup.findUnique({ where: { id: rule.groupId }, select: { optIn: true } }),
        db.subscriptionState.findUnique({ where: { groupId_contactId: { groupId: rule.groupId, contactId } } }),
      ]);
      return !!group && isSubscribed(group, state?.subscribed);
    }
    case "reachable": {
      if (rule.channel === "EMAIL") return (await db.contact.count({ where: { id: contactId, email: { not: null } } })) > 0;
      const channels: Channel[] = rule.channel === "ANY_PUSH" ? ["FCM", "APNS", "WEB_PUSH"] : [rule.channel];
      return (await db.pushSubscription.count({ where: { contactId, isActive: true, channel: { in: channels } } })) > 0;
    }
  }
}

// ------------------------------------------------------------ event hooks

/**
 * Called for every ingested event: enrol contacts in journeys triggered by it, resume runs
 * waiting for it, and take contacts out of journeys whose exit event it is.
 */
export async function journeyEventHooks(contactId: string, event: string): Promise<void> {
  // 1. Exit criteria
  const exiting = await db.journeyRun.findMany({
    where: { contactId, completedAt: null, journey: { status: "ACTIVE", exitEvent: event } },
    select: { id: true },
  });
  for (const r of exiting) await complete(r.id, "exit_event");

  // 2. Resume WAIT_EVENT nodes
  const waiting = await db.journeyRun.findMany({
    where: { contactId, completedAt: null, waitingEvent: event, journey: { status: "ACTIVE" } },
    include: { journey: { include: { steps: true } } },
  });
  for (const run of waiting) {
    const node = run.journey.steps.find((s) => s.key === run.currentKey);
    if (!node) continue;
    const target = (node.next as Next).event;
    // Conditional update: a concurrent timeout or duplicate event mustn't resume twice
    const { count } = await db.journeyRun.updateMany({
      where: { id: run.id, waitingEvent: event, currentKey: run.currentKey },
      data: { waitingEvent: null, waitUntil: null, currentKey: target ?? null },
    });
    if (!count) continue;
    await visit(run.journeyId, run.id, node.key!, "event");
    if (!target) await complete(run.id, "completed");
    else await enqueue("JOURNEY_STEP", { journeyId: run.journeyId, contactId, key: target });
  }

  // 3. Event-triggered entry
  const journeys = await db.journey.findMany({
    where: { status: "ACTIVE", triggerEvent: event },
    include: { segment: true, steps: { orderBy: { order: "asc" } } },
  });
  for (const journey of journeys) {
    if (journey.segment) {
      const inSegment = await db.contact.count({ where: { AND: [{ id: contactId }, filtersToWhere(journey.segment.filters as unknown as SegmentFilter[])] } });
      if (!inSegment) continue;
    }
    const existing = await db.journeyRun.findUnique({ where: { journeyId_contactId: { journeyId: journey.id, contactId } } });
    if (existing) continue; // once per contact
    const run = await db.journeyRun.create({ data: { journeyId: journey.id, contactId } }).catch(() => null); // lost a race: fine
    if (!run) continue;
    if (journey.entryKey) await startRun(journey, run);
    else if (journey.steps.length) {
      await enqueue("JOURNEY_STEP", { journeyId: journey.id, contactId, stepOrder: journey.steps[0].order }, new Date(Date.now() + journey.steps[0].delayMinutes * 60_000));
    }
  }
}
