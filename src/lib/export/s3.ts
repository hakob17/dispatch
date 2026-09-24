import { gzipSync } from "node:zlib";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { db } from "../db";

/**
 * Bulk export to S3 as gzipped NDJSON parts:
 *   s3://$EXPORT_S3_BUCKET/<prefix>/<type>/<exportId>/part-00000.ndjson.gz
 *
 * Rows are streamed by keyset pagination (id order), so volume is bounded by
 * S3, not memory. Credentials come from the default AWS chain (the ECS task
 * role in production), never from the database.
 */
export type ExportType = "contacts" | "events" | "messages" | "message_events";

export interface ExportPayload {
  exportId: string;
  type: ExportType;
  since?: string; // ISO date — only rows created at/after this
  until?: string;
}

const PART_ROWS = Number(process.env.EXPORT_PART_ROWS) || 100_000;
const PAGE = 5000;

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({ region: process.env.EXPORT_S3_REGION || process.env.AWS_REGION });
  return client;
}

export function exportBucket(): string | null {
  return process.env.EXPORT_S3_BUCKET || null;
}

export function exportKeyPrefix(p: Pick<ExportPayload, "exportId" | "type">): string {
  const base = (process.env.EXPORT_S3_PREFIX || "dispatch-exports").replace(/\/+$/, "");
  return `${base}/${p.type}/${p.exportId}`;
}

type Row = { id: string } & Record<string, unknown>;

async function page(type: ExportType, after: string | undefined, range: { gte?: Date; lt?: Date }): Promise<Row[]> {
  const createdAt = range.gte || range.lt ? { createdAt: range } : {};
  const args = {
    where: { ...createdAt, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" as const },
    take: PAGE,
  };
  switch (type) {
    case "contacts":
      return db.contact.findMany({
        ...args,
        include: {
          subscriptions: { select: { channel: true, endpoint: true, platform: true, isActive: true, createdAt: true, lastUsedAt: true } },
          subscriptionStates: { select: { groupId: true, subscribed: true } },
        },
      });
    case "events":
      return db.contactEvent.findMany(args);
    case "messages":
      return db.message.findMany(args);
    case "message_events":
      return db.messageEvent.findMany(args);
  }
}

export async function handleExportS3(payload: ExportPayload): Promise<void> {
  const bucket = exportBucket();
  if (!bucket) throw new SyntaxError("EXPORT_S3_BUCKET is not set"); // SyntaxError = not retryable
  const range = {
    ...(payload.since ? { gte: new Date(payload.since) } : {}),
    ...(payload.until ? { lt: new Date(payload.until) } : {}),
  };
  const prefix = exportKeyPrefix(payload);

  let after: string | undefined;
  let part = 0;
  let total = 0;
  let buffer: string[] = [];

  const flush = async () => {
    if (!buffer.length) return;
    const key = `${prefix}/part-${String(part).padStart(5, "0")}.ndjson.gz`;
    await s3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: gzipSync(buffer.join("\n") + "\n"),
        ContentType: "application/x-ndjson",
        ContentEncoding: "gzip",
      })
    );
    part++;
    buffer = [];
  };

  for (;;) {
    const rows = await page(payload.type, after, range);
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    for (const r of rows) buffer.push(JSON.stringify(r));
    total += rows.length;
    if (buffer.length >= PART_ROWS) await flush();
    if (rows.length < PAGE) break;
  }
  await flush();

  // Manifest last: its presence means the export is complete
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${prefix}/manifest.json`,
      Body: JSON.stringify({ exportId: payload.exportId, type: payload.type, since: payload.since ?? null, until: payload.until ?? null, rows: total, parts: part, completedAt: new Date().toISOString() }),
      ContentType: "application/json",
    })
  );
  console.log(`[export] ${payload.type} ${payload.exportId}: ${total} rows in ${part} part(s) → s3://${bucket}/${prefix}/`);
}
