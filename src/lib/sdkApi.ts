import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { ApiKey } from "@prisma/client";
import { authenticateApi } from "./apiAuth";
import { appSecret } from "./secret";
import type { IdentityRef } from "./identity";

/**
 * Shared plumbing for the client SDK endpoints (/api/sdk/v1/*):
 * CORS (browser apps), SDK-or-SERVER key auth + rate limits, JSON/zod parsing,
 * and optional signed user tokens.
 *
 * SDK keys ship inside apps, so they are public. When SDK_REQUIRE_USER_TOKEN
 * is "true", any call that names an externalId must also carry
 * `X-Dispatch-User-Token`, minted by your backend through
 * POST /api/v1/sdk-tokens — so one user can't act as another by guessing ids.
 */
export function corsHeaders(req: NextRequest): Record<string, string> {
  const allowed = (process.env.SDK_CORS_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = req.headers.get("origin") || "";
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : "";
  return {
    ...(allow ? { "Access-Control-Allow-Origin": allow } : {}),
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Dispatch-User-Token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function sdkOptions(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export function userToken(externalId: string): string {
  return createHmac("sha256", appSecret()).update(`sdk-user:${externalId}`).digest("base64url");
}

function userTokenValid(externalId: string, token: string | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(userToken(externalId));
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export const identitySchema = z.object({
  externalId: z.string().min(1).max(255).optional(),
  anonymousId: z.string().min(8).max(128).optional(),
  email: z.string().email().optional(),
});

type Handler<T> = (ctx: { req: NextRequest; body: T; key: ApiKey | null }) => Promise<NextResponse>;

/** Wrap an SDK route: CORS + auth + rate limit + body validation. */
export function sdkRoute<T>(endpoint: string, schema: z.ZodType<T> | null, handler: Handler<T>) {
  return apiRoute(endpoint, schema, handler, { scopes: ["SDK"], openWhenNoKeys: true, cors: true });
}

/**
 * Wrap a server-to-server route (/api/v1/*): SERVER key always required —
 * these endpoints send messages and export personal data.
 */
export function serverRoute<T>(endpoint: string, schema: z.ZodType<T> | null, handler: Handler<T>) {
  return apiRoute(endpoint, schema, handler, { scopes: ["SERVER"], openWhenNoKeys: false, cors: false });
}

function apiRoute<T>(
  endpoint: string,
  schema: z.ZodType<T> | null,
  handler: Handler<T>,
  opts: { scopes: ApiKey["scope"][]; openWhenNoKeys: boolean; cors: boolean }
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const cors = opts.cors ? corsHeaders(req) : {};
    const withHeaders = (res: NextResponse, extra: Record<string, string> = {}) => {
      for (const [k, v] of Object.entries({ ...cors, ...extra })) res.headers.set(k, v);
      return res;
    };

    const auth = await authenticateApi(req, endpoint, { scopes: opts.scopes, openWhenNoKeys: opts.openWhenNoKeys });
    if (!auth.ok) return withHeaders(auth.response);

    let body: T;
    if (schema) {
      let raw: unknown = {};
      if (req.method === "GET") raw = Object.fromEntries(req.nextUrl.searchParams);
      else {
        try {
          raw = await req.json();
        } catch {
          return withHeaders(NextResponse.json({ error: "invalid JSON body" }, { status: 400 }), auth.headers);
        }
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) return withHeaders(NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 }), auth.headers);
      body = parsed.data;
    } else body = undefined as T;

    const ref = body as IdentityRef | undefined;
    if (process.env.SDK_REQUIRE_USER_TOKEN === "true" && auth.key?.scope === "SDK" && ref?.externalId) {
      if (!userTokenValid(ref.externalId, req.headers.get("x-dispatch-user-token"))) {
        return withHeaders(NextResponse.json({ error: "valid X-Dispatch-User-Token required for externalId" }, { status: 401 }), auth.headers);
      }
    }

    try {
      return withHeaders(await handler({ req, body, key: auth.key }), auth.headers);
    } catch (err) {
      console.error(`[api] ${endpoint} failed:`, err);
      return withHeaders(NextResponse.json({ error: "internal error" }, { status: 500 }), auth.headers);
    }
  };
}
