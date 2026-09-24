import type { LiveActivity, LiveActivityToken, Prisma } from "@prisma/client";
import { db, durableWrite } from "./db";
import { enqueueMany } from "./queue/enqueue";
import { apnsRequest } from "./channels/push/apns";
import { getApnsConfig } from "./settings";
import { fcmSendRaw } from "./channels/push/fcm";
import { mockEnabled } from "./channels/mock";

/**
 * iOS Live Activities (ActivityKit push, apns-push-type: liveactivity) and
 * Android Live Updates (FCM data message the app renders as a progress-style
 * ongoing notification).
 *
 * Lifecycle, driven by your backend through /api/v1/live-activities:
 *   start  — push-to-start on iOS 17.2+ devices of the audience (+ Android followers)
 *   update — new content-state to every device showing the activity
 *   end    — final state, then dismissed
 */
export type LiveEvent = "start" | "update" | "end";

export interface LiveEventOptions {
  contentState: Record<string, unknown>;
  alert?: { title: string; body: string; sound?: string };
  /** iOS: after this, the system marks the activity stale (ISO time) */
  staleDate?: string;
  /** iOS end: when to remove it from the Lock Screen (ISO time; default: system decides) */
  dismissalDate?: string;
  /** iOS: ordering when several activities are live */
  relevanceScore?: number;
  /** "high" = apns-priority 10 (counts against Apple's budget); "low" = 5 */
  priority?: "high" | "low";
}

interface SendJobPayload {
  liveActivityId: string;
  event: LiveEvent;
  options: LiveEventOptions;
  tokenIds: string[];
}

/** Queue delivery of one lifecycle event to the given tokens (500 per job). */
export async function queueLiveEvent(activity: LiveActivity, event: LiveEvent, options: LiveEventOptions, tokens: { id: string }[]): Promise<number> {
  const jobs = [];
  for (let i = 0; i < tokens.length; i += 500) {
    const payload: SendJobPayload = { liveActivityId: activity.id, event, options, tokenIds: tokens.slice(i, i + 500).map((t) => t.id) };
    jobs.push({ type: "LIVE_ACTIVITY_SEND" as const, payload: payload as unknown as Record<string, unknown> });
  }
  if (jobs.length) await enqueueMany(jobs);
  return tokens.length;
}

export function apnsLivePayload(activity: LiveActivity, event: LiveEvent, o: LiveEventOptions): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    timestamp: Math.floor(Date.now() / 1000),
    event,
    "content-state": o.contentState,
  };
  if (event === "start") {
    aps["attributes-type"] = activity.activityType;
    aps.attributes = activity.attributes;
  }
  if (o.alert) aps.alert = { title: o.alert.title, body: o.alert.body, ...(o.alert.sound ? { sound: o.alert.sound } : {}) };
  if (o.staleDate) aps["stale-date"] = Math.floor(Date.parse(o.staleDate) / 1000);
  if (event === "end" && o.dismissalDate) aps["dismissal-date"] = Math.floor(Date.parse(o.dismissalDate) / 1000);
  if (o.relevanceScore !== undefined) aps["relevance-score"] = o.relevanceScore;
  return { aps };
}

/** Data-only FCM message; the app's FirebaseMessagingService renders the Live Update. */
export function fcmLiveData(activity: LiveActivity, event: LiveEvent, o: LiveEventOptions): Record<string, string> {
  return {
    dispatchType: "live_update",
    activityKey: activity.key,
    activityType: activity.activityType,
    event,
    contentState: JSON.stringify(o.contentState),
    ...(event === "start" ? { attributes: JSON.stringify(activity.attributes) } : {}),
    ...(o.alert ? { alertTitle: o.alert.title, alertBody: o.alert.body } : {}),
    ...(o.staleDate ? { staleDate: o.staleDate } : {}),
  };
}

/** Worker handler for LIVE_ACTIVITY_SEND. */
export async function handleLiveActivitySend(p: SendJobPayload): Promise<void> {
  const activity = await db.liveActivity.findUnique({ where: { id: p.liveActivityId } });
  if (!activity) return;
  const tokens = await db.liveActivityToken.findMany({ where: { id: { in: p.tokenIds }, isActive: true } });
  const ios = tokens.filter((t) => t.kind !== "FOLLOW");
  const android = tokens.filter((t) => t.kind === "FOLLOW");
  const dead: string[] = [];

  if (ios.length) {
    const cfg = await getApnsConfig();
    if (!cfg && !mockEnabled()) throw new SyntaxError("APNs not configured — Live Activities need a direct APNs key");
    const body = JSON.stringify(apnsLivePayload(activity, p.event, p.options));
    const limit = Number(process.env.APNS_CONCURRENCY) || 200;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(limit, ios.length) }, async () => {
        while (next < ios.length) {
          const t = ios[next++];
          if (mockEnabled()) continue;
          const r = await apnsRequest(cfg!, t.token, body, {
            "apns-push-type": "liveactivity",
            "apns-topic": `${cfg!.bundleId}.push-type.liveactivity`,
            "apns-priority": p.options.priority === "low" ? "5" : "10",
          });
          if (!r.ok && r.deactivate) dead.push(t.id);
          if (!r.ok && !r.deactivate) console.warn(`[live] apns ${t.id}: ${r.error}`);
        }
      })
    );
  }

  if (android.length && !mockEnabled()) {
    const results = await fcmSendRaw(
      android.map((t) => ({
        token: t.token,
        data: fcmLiveData(activity, p.event, p.options),
        android: { priority: p.options.priority === "low" ? "normal" : "high", collapseKey: `live-${activity.key}` },
      }))
    );
    results.forEach((r, i) => {
      if (!r.ok && r.deactivate) dead.push(android[i].id);
    });
  }

  await durableWrite(async () => {
    if (dead.length) await db.liveActivityToken.updateMany({ where: { id: { in: dead } }, data: { isActive: false } });
    await db.liveActivity.update({
      where: { id: activity.id },
      data: { updatesSent: { increment: tokens.length - dead.length }, lastEventAt: new Date() },
    });
  });
}

/** Tokens an event should reach. */
export async function audienceTokens(activity: LiveActivity, event: LiveEvent, contactWhere?: Prisma.ContactWhereInput): Promise<LiveActivityToken[]> {
  if (event === "start") {
    // Remote start: push-to-start tokens for this activity type + Android devices following the key
    return db.liveActivityToken.findMany({
      where: {
        isActive: true,
        OR: [
          { kind: "PUSH_TO_START", activityType: activity.activityType },
          { kind: "FOLLOW", activityKey: activity.key },
        ],
        ...(contactWhere ? { contact: contactWhere } : {}),
      },
    });
  }
  return db.liveActivityToken.findMany({
    where: { isActive: true, activityKey: activity.key, kind: { in: ["UPDATE", "FOLLOW"] } },
  });
}

