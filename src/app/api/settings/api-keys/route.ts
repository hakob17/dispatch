import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { generateApiKey } from "@/lib/apiAuth";

// Admin-only (middleware: /api/settings/*).

export async function GET() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  since.setHours(0, 0, 0, 0);

  const [keys, usage] = await Promise.all([
    db.apiKey.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    }),
    db.apiUsage.findMany({ where: { date: { gte: since } } }),
  ]);

  const byKey: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const byEndpoint: Record<string, number> = {};
  for (const u of usage) {
    byKey[u.keyId] = (byKey[u.keyId] ?? 0) + u.count;
    const day = u.date.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + u.count;
    byEndpoint[u.endpoint] = (byEndpoint[u.endpoint] ?? 0) + u.count;
  }

  return NextResponse.json({
    keys: keys.map((k) => ({ ...k, requests30d: byKey[k.id] ?? 0 })),
    usage: { byDay, byEndpoint, total30d: usage.reduce((s, u) => s + u.count, 0) },
  });
}

export async function POST(req: NextRequest) {
  const body = z.object({ name: z.string().min(1) }).safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  const { raw, prefix, keyHash } = generateApiKey();
  const key = await db.apiKey.create({ data: { name: body.data.name, prefix, keyHash } });
  // raw key is returned exactly once
  return NextResponse.json({ id: key.id, name: key.name, prefix, key: raw }, { status: 201 });
}
