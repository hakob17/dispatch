import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { serverRoute } from "@/lib/sdkApi";
import { enqueue } from "@/lib/queue/enqueue";
import { exportBucket, exportKeyPrefix } from "@/lib/export/s3";
import { audit } from "@/lib/audit";

const schema = z.object({
  type: z.enum(["contacts", "events", "messages", "message_events"]),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
});

/**
 * Start an asynchronous bulk export to S3 (gzipped NDJSON parts + manifest.json).
 * Poll for s3://<bucket>/<prefix>/manifest.json to know it finished.
 */
export const POST = serverRoute("/api/v1/exports", schema, async ({ body, key }) => {
  const bucket = exportBucket();
  if (!bucket) return NextResponse.json({ error: "S3 export not configured (EXPORT_S3_BUCKET)" }, { status: 501 });
  const exportId = randomUUID();
  await enqueue("EXPORT_S3", { exportId, ...body });
  await audit({ userEmail: key ? `api-key:${key.prefix}` : null, action: "api.exports.create", meta: { exportId, ...body } });
  return NextResponse.json(
    { exportId, location: `s3://${bucket}/${exportKeyPrefix({ exportId, type: body.type })}/`, manifest: "manifest.json" },
    { status: 202 }
  );
});
