import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";

/** Generate a new API key. The raw key is shown once; only its hash is stored. */
export function generateApiKey(): { raw: string; prefix: string; keyHash: string } {
  const raw = `dk_${randomBytes(24).toString("hex")}`;
  return { raw, prefix: raw.slice(0, 8), keyHash: hashKey(raw) };
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Gate a public data endpoint with API keys, Braze-style.
 * Open while no active keys exist (easy local dev); once the first key is
 * created, requests must carry `Authorization: Bearer <key>` (or X-API-Key).
 * Returns an error response to send, or null when the request may proceed.
 */
export async function requireApiKey(req: NextRequest, endpoint: string): Promise<NextResponse | null> {
  const activeKeys = await db.apiKey.count({ where: { revokedAt: null } });
  if (activeKeys === 0) return null;

  const auth = req.headers.get("authorization");
  const raw = auth?.startsWith("Bearer ") ? auth.slice(7) : req.headers.get("x-api-key");
  if (!raw) {
    return NextResponse.json({ error: "API key required (Authorization: Bearer <key>)" }, { status: 401 });
  }

  const key = await db.apiKey.findUnique({ where: { keyHash: hashKey(raw) } });
  if (!key || key.revokedAt) {
    return NextResponse.json({ error: "invalid API key" }, { status: 401 });
  }

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

  return null;
}
