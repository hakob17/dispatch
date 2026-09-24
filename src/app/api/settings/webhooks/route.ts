import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { EVENT_TYPES, invalidateEndpointCache } from "@/lib/webhooks/events";
import { SEGMENT_ENDPOINTS } from "@/lib/segmentOutbound";

// Admin-only (proxy: /api/settings/*).

export async function GET() {
  const endpoints = await db.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    eventTypes: EVENT_TYPES,
    endpoints: endpoints.map(({ secret, ...e }) => ({ ...e, secretPreview: `${secret.slice(0, e.kind === "SEGMENT" ? 4 : 10)}…` })),
  });
}

const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("WEBHOOK").default("WEBHOOK"),
    name: z.string().min(1),
    url: z.string().url().refine((u) => u.startsWith("https://") || process.env.NODE_ENV !== "production", "https required"),
    events: z.array(z.enum(EVENT_TYPES)).default([]),
  }),
  z.object({
    kind: z.literal("SEGMENT"),
    name: z.string().min(1),
    region: z.enum(["us", "eu"]).default("us"),
    writeKey: z.string().min(10),
    events: z.array(z.enum(EVENT_TYPES)).default([]),
  }),
]);

export async function POST(req: NextRequest) {
  const raw = await req.json();
  const body = schema.safeParse({ kind: "WEBHOOK", ...raw });
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  if (body.data.kind === "SEGMENT") {
    const { name, region, writeKey, events } = body.data;
    const ep = await db.webhookEndpoint.create({ data: { kind: "SEGMENT", name, url: SEGMENT_ENDPOINTS[region], secret: writeKey, events } });
    invalidateEndpointCache();
    return NextResponse.json({ id: ep.id }, { status: 201 });
  }
  const { name, url, events } = body.data;
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const ep = await db.webhookEndpoint.create({ data: { kind: "WEBHOOK", name, url, events, secret } });
  invalidateEndpointCache();
  // Secret is returned once, for the receiver to verify X-Dispatch-Signature
  return NextResponse.json({ id: ep.id, secret }, { status: 201 });
}
