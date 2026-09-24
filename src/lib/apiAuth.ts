import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import type { ApiKey, ApiKeyScope } from "@prisma/client";
import { db } from "./db";
import { clientIp, hitRateLimit, rateLimitedResponse } from "./rateLimit";

/** Generate a new API key. The raw key is shown once; only its hash is stored. */
export function generateApiKey(scope: ApiKeyScope = "SERVER"): { raw: string; prefix: string; keyHash: string } {
  const raw = `${scope === "SDK" ? "dk_pub" : "dk"}_${randomBytes(24).toString("hex")}`;
  return { raw, prefix: raw.slice(0, scope === "SDK" ? 12 : 8), keyHash: hashKey(raw) };
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Per-key request budgets (requests/minute). Override via env for your plan. */
export function rateLimitFor(scope: ApiKeyScope | "ANON"): number {
  if (scope === "SERVER") return Number(process.env.API_RATE_LIMIT_SERVER_PER_MIN) || 6000;
  if (scope === "SDK") return Number(process.env.API_RATE_LIMIT_SDK_PER_MIN) || 60000;
  return Number(process.env.API_RATE_LIMIT_ANON_PER_MIN) || 120;
}

export interface ApiAuthOptions {
  /** Scopes allowed on this endpoint. SERVER keys are always accepted. */
  scopes?: ApiKeyScope[];
  /**
   * Allow unauthenticated calls while no API keys exist at all (local dev).
   * Endpoints that can send messages or export data set this to false.
   */
  openWhenNoKeys?: boolean;
}

export type ApiAuthResult =
  | { ok: true; key: ApiKey | null; headers: Record<string, string> }
  | { ok: false; response: NextResponse };

let keyCountCache: { count: number; at: number } | null = null;
async function activeKeyCount(): Promise<number> {
  if (keyCountCache && Date.now() - keyCountCache.at < 30_000) return keyCountCache.count;
  const count = await db.apiKey.count({ where: { revokedAt: null } });
  keyCountCache = { count, at: Date.now() };
  return count;
}
export function invalidateKeyCache(): void {
  keyCountCache = null;
}

/**
 * Authenticate + rate-limit a public API call.
 * Key via `Authorization: Bearer <key>` or `X-API-Key`.
 */
export async function authenticateApi(req: NextRequest, endpoint: string, opts: ApiAuthOptions = {}): Promise<ApiAuthResult> {
  const { scopes = ["SERVER"], openWhenNoKeys = true } = opts;
  const auth = req.headers.get("authorization");
  const raw = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : req.headers.get("x-api-key");

  if (!raw) {
    if (openWhenNoKeys && (await activeKeyCount()) === 0) {
      const rl = await hitRateLimit(`ip:${clientIp(req.headers)}`, rateLimitFor("ANON"));
      if (!rl.allowed) return { ok: false, response: rateLimitedResponse(rl) };
      return { ok: true, key: null, headers: {} };
    }
    return { ok: false, response: NextResponse.json({ error: "API key required (Authorization: Bearer <key>)" }, { status: 401 }) };
  }

  const key = await db.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
  if (!key || key.revokedAt) {
    return { ok: false, response: NextResponse.json({ error: "invalid API key" }, { status: 401 }) };
  }
  if (key.scope !== "SERVER" && !scopes.includes(key.scope)) {
    return { ok: false, response: NextResponse.json({ error: `a ${scopes.join("/")} key is required for this endpoint` }, { status: 403 }) };
  }

  const rl = await hitRateLimit(`key:${key.id}`, rateLimitFor(key.scope));
  if (!rl.allowed) return { ok: false, response: rateLimitedResponse(rl) };

  // Usage accounting — never block the request on it
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  Promise.all([
    db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }),
    db.apiUsage.upsert({
      where: { keyId_endpoint_date: { keyId: key.id, endpoint, date: today } },
      create: { keyId: key.id, endpoint, date: today, count: 1 },
      update: { count: { increment: 1 } },
    }),
  ]).catch(() => {});

  return {
    ok: true,
    key,
    headers: {
      "X-RateLimit-Limit": String(rl.limit),
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(Math.ceil(rl.resetAt.getTime() / 1000)),
    },
  };
}

/** Back-compat wrapper: returns an error response, or null when the request may proceed. */
export async function requireApiKey(req: NextRequest, endpoint: string, opts?: ApiAuthOptions): Promise<NextResponse | null> {
  const res = await authenticateApi(req, endpoint, { scopes: ["SERVER", "SDK"], ...opts });
  return res.ok ? null : res.response;
}
