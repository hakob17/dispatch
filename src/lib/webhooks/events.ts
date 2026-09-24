import { createHmac, randomUUID } from "crypto";
import type { WebhookEndpoint } from "@prisma/client";
import { resolveAlert, webhookFailed, WEBHOOK_ALERT_AFTER } from "../alerts";
import { db } from "../db";
import { enqueueMany } from "../queue/enqueue";
import { toSegmentBatch } from "../segmentOutbound";

/**
 * Outbound event stream. Message lifecycle events are delivered to every
 * active WebhookEndpoint as signed JSON batches:
 *
 *   POST <endpoint.url>
 *   X-Dispatch-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<body>">
 *   { "events": [ { id, type, timestamp, data: { messageId, ... } } ] }
 *
 * Delivery is at-least-once (retried with backoff through the job queue);
 * receivers should dedupe on event `id`.
 */
export const EVENT_TYPES = [
  "message.sent", // handed off to SES / FCM / APNs / push service
  "message.delivered", // provider or device confirmed delivery
  "message.failed",
  "message.bounced",
  "message.opened",
  "message.clicked",
  "message.converted",
  "contact.unsubscribed",
] as const;
export type EventTypeName = (typeof EVENT_TYPES)[number];

export interface OutboundEvent {
  id: string;
  type: EventTypeName;
  timestamp: string;
  data: Record<string, unknown>;
}

export function makeEvent(type: EventTypeName, data: Record<string, unknown>): OutboundEvent {
  return { id: randomUUID(), type, timestamp: new Date().toISOString(), data };
}

let endpointCache: { rows: WebhookEndpoint[]; at: number } | null = null;
async function activeEndpoints(): Promise<WebhookEndpoint[]> {
  if (endpointCache && Date.now() - endpointCache.at < 30_000) return endpointCache.rows;
  const rows = await db.webhookEndpoint.findMany({ where: { isActive: true } });
  endpointCache = { rows, at: Date.now() };
  return rows;
}
export function invalidateEndpointCache(): void {
  endpointCache = null;
}

/** Queue events for delivery to all subscribed endpoints. Cheap no-op when none exist. */
export async function emitEvents(events: OutboundEvent[]): Promise<void> {
  if (!events.length) return;
  const endpoints = await activeEndpoints();
  if (!endpoints.length) return;

  const jobs: { type: "DELIVER_WEBHOOK"; payload: Record<string, unknown> }[] = [];
  for (const ep of endpoints) {
    const wanted = (ep.events as string[]) ?? [];
    const matching = wanted.length ? events.filter((e) => wanted.includes(e.type)) : events;
    for (let i = 0; i < matching.length; i += 500) {
      jobs.push({ type: "DELIVER_WEBHOOK", payload: { endpointId: ep.id, events: matching.slice(i, i + 500) } });
    }
  }
  if (jobs.length) await enqueueMany(jobs);
}

export function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

/** Worker handler for DELIVER_WEBHOOK jobs. Throws on failure so the queue retries. */
export async function deliverWebhook(payload: { endpointId: string; events: OutboundEvent[] }): Promise<void> {
  const ep = await db.webhookEndpoint.findUnique({ where: { id: payload.endpointId } });
  if (!ep || !ep.isActive) return;
  const segment = ep.kind === "SEGMENT";
  const body = JSON.stringify(segment ? toSegmentBatch(payload.events) : { events: payload.events });
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Dispatch-Webhooks/1.0",
        ...(segment
          ? { Authorization: `Basic ${Buffer.from(`${ep.secret}:`).toString("base64")}` } // secret = Segment write key
          : { "X-Dispatch-Signature": signBody(ep.secret, body) }),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await db.webhookEndpoint.update({
      where: { id: ep.id },
      data: { lastSuccessAt: new Date(), failureCount: 0, lastError: null },
    });
    if (ep.failureCount >= WEBHOOK_ALERT_AFTER) await resolveAlert(`webhook:${ep.id}`, `Webhook "${ep.name}" is delivering again`);
  } catch (err) {
    const updated = await db.webhookEndpoint.update({
      where: { id: ep.id },
      data: { failureCount: { increment: 1 }, lastError: String(err).slice(0, 500) },
    });
    await webhookFailed(ep, updated.failureCount, String(err).slice(0, 300));
    throw err;
  }
}

/** Standard payload for a message event. */
export function messageEventData(m: {
  id: string;
  campaignId?: string | null;
  journeyStepId?: string | null;
  contactId: string;
  channel: string;
  externalId?: string | null;
  error?: string | null;
}): Record<string, unknown> {
  return {
    messageId: m.id,
    campaignId: m.campaignId ?? null,
    journeyStepId: m.journeyStepId ?? null,
    contactId: m.contactId,
    externalId: m.externalId ?? null,
    channel: m.channel,
    ...(m.error ? { error: m.error } : {}),
  };
}
