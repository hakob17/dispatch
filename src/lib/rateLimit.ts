import { NextResponse } from "next/server";
import { db, utcTs } from "./db";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

/**
 * Fixed-window counter stored in Postgres, so the limit is shared by every
 * app instance behind the load balancer (no Redis needed). One upsert per
 * request; old windows are purged by the worker's housekeeping.
 */
export async function hitRateLimit(key: string, limit: number, windowSec = 60): Promise<RateLimitResult> {
  const windowMs = windowSec * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${utcTs(windowStart)}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitBucket"."count" + 1
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 1);
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(Math.ceil(r.resetAt.getTime() / 1000)),
  };
}

/** 429 with Retry-After. Nothing is queued for a rejected request — the caller must retry. */
export function rateLimitedResponse(r: RateLimitResult): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((r.resetAt.getTime() - Date.now()) / 1000));
  return NextResponse.json(
    {
      error: "rate_limited",
      message: `Rate limit of ${r.limit} requests/minute exceeded. Nothing from this request was accepted; retry after ${retryAfter}s.`,
      retryAfterSeconds: retryAfter,
    },
    { status: 429, headers: { ...rateLimitHeaders(r), "Retry-After": String(retryAfter) } }
  );
}

export function clientIp(headers: Headers): string {
  // Behind an AWS ALB / CloudFront the client is the first X-Forwarded-For hop
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip") || "unknown";
}

export async function purgeOldRateLimitBuckets(): Promise<void> {
  await db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 3600_000) } } });
}
