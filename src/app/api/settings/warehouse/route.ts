import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";
import { enqueue } from "@/lib/queue/enqueue";
import { dailyExportEnabled, exportLocation, WAREHOUSE_TYPES, warehouseSetup, type WarehouseTarget } from "@/lib/warehouse";

// Admin-only (proxy: /api/settings/*).

/** Status of the daily S3 landing, plus the load setup for ?target=snowflake|redshift|bigquery. */
export async function GET(req: NextRequest) {
  const target = (req.nextUrl.searchParams.get("target") ?? "snowflake") as WarehouseTarget;
  const loc = exportLocation();
  return NextResponse.json({
    bucket: loc.bucket,
    prefix: loc.prefix,
    daily: await dailyExportEnabled(),
    dailyFromEnv: process.env.EXPORT_S3_DAILY === "true",
    lastDaily: (await getSetting<{ date: string }>("dailyExport"))?.date ?? null,
    types: WAREHOUSE_TYPES,
    target,
    setup: ["snowflake", "redshift", "bigquery"].includes(target) ? warehouseSetup(target, loc) : null,
  });
}

const schema = z.object({ daily: z.boolean().optional(), exportNow: z.boolean().optional() });

/** Turn the daily landing on/off, or export yesterday right away (e.g. to test the pipeline). */
export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  if (!exportLocation().bucket) return NextResponse.json({ error: "Set EXPORT_S3_BUCKET first (Terraform creates it on AWS)." }, { status: 400 });
  if (body.data.daily !== undefined) await setSetting("warehouse.daily", body.data.daily);
  if (body.data.exportNow) {
    const until = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const since = new Date(until.getTime() - 86400_000);
    const day = since.toISOString().slice(0, 10);
    for (const type of WAREHOUSE_TYPES) await enqueue("EXPORT_S3", { exportId: `daily-${day}`, type, since: since.toISOString(), until: until.toISOString() });
  }
  return NextResponse.json({ ok: true });
}
