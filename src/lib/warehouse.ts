import { exportBucket } from "./export/s3";
import { getSetting } from "./settings";

/**
 * Warehouse connectors (RFP 3.5): Dispatch lands data in S3 every day
 * (s3://<bucket>/<prefix>/<type>/daily-YYYY-MM-DD/part-*.ndjson.gz + manifest.json) and the
 * warehouse loads it with its native S3 ingestion — Snowpipe, Redshift COPY, or the BigQuery
 * Data Transfer Service. This module generates that setup, with the tables typed to match.
 */
export type WarehouseTarget = "snowflake" | "redshift" | "bigquery";
export const WAREHOUSE_TYPES = ["events", "messages", "message_events"] as const;

type Col = { name: string; type: "string" | "timestamp" | "json" | "int" };
/** Columns of each export type, in the NDJSON's own camelCase field names. */
export const EXPORT_COLUMNS: Record<(typeof WAREHOUSE_TYPES)[number], Col[]> = {
  events: [
    { name: "id", type: "string" }, { name: "contactId", type: "string" }, { name: "name", type: "string" },
    { name: "properties", type: "json" }, { name: "createdAt", type: "timestamp" },
  ],
  messages: [
    { name: "id", type: "string" }, { name: "campaignId", type: "string" }, { name: "variantId", type: "string" },
    { name: "journeyStepId", type: "string" }, { name: "contactId", type: "string" }, { name: "pushSubscriptionId", type: "string" },
    { name: "channel", type: "string" }, { name: "status", type: "string" }, { name: "providerMessageId", type: "string" },
    { name: "error", type: "string" }, { name: "attempts", type: "int" }, { name: "contentItemId", type: "string" },
    { name: "sentAt", type: "timestamp" }, { name: "deliveredAt", type: "timestamp" }, { name: "openedAt", type: "timestamp" },
    { name: "clickedAt", type: "timestamp" }, { name: "convertedAt", type: "timestamp" }, { name: "createdAt", type: "timestamp" },
  ],
  message_events: [
    { name: "id", type: "string" }, { name: "messageId", type: "string" }, { name: "type", type: "string" },
    { name: "meta", type: "json" }, { name: "createdAt", type: "timestamp" },
  ],
};

export async function dailyExportEnabled(): Promise<boolean> {
  if (process.env.EXPORT_S3_DAILY === "true") return true;
  return (await getSetting<boolean>("warehouse.daily")) === true;
}

export function exportLocation() {
  return {
    bucket: exportBucket(),
    prefix: (process.env.EXPORT_S3_PREFIX || "dispatch-exports").replace(/\/+$/, ""),
    region: process.env.EXPORT_S3_REGION || process.env.AWS_REGION || "eu-west-1",
  };
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Ready-to-run setup for one warehouse, with placeholders only where the customer's names go. */
export function warehouseSetup(target: WarehouseTarget, loc = exportLocation()): string {
  const bucket = loc.bucket ?? "<EXPORT_S3_BUCKET>";
  const root = `s3://${bucket}/${loc.prefix}`;
  switch (target) {
    case "snowflake": return snowflake(root);
    case "redshift": return redshift(root, loc.region);
    case "bigquery": return bigquery(root);
  }
}

function snowflake(root: string): string {
  const typ = (c: Col) => (c.type === "json" ? "VARIANT" : c.type === "timestamp" ? "TIMESTAMP_NTZ" : c.type === "int" ? "NUMBER" : "VARCHAR");
  const tables = WAREHOUSE_TYPES.map((t) => {
    const cols = EXPORT_COLUMNS[t];
    return `CREATE TABLE IF NOT EXISTS dispatch_${t} (
  ${cols.map((c) => `${snake(c.name)} ${typ(c)}`).join(",\n  ")},
  _file VARCHAR, _loaded_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- Loads each new daily file automatically (S3 event notifications → the pipe's SQS queue)
CREATE PIPE IF NOT EXISTS dispatch_${t}_pipe AUTO_INGEST = TRUE AS
COPY INTO dispatch_${t} (${cols.map((c) => snake(c.name)).join(", ")}, _file)
FROM (
  SELECT ${cols.map((c) => `$1:${c.name}::${typ(c)}`).join(", ")}, METADATA$FILENAME
  FROM @dispatch_stage/${t}/
)
PATTERN = '.*/part-[0-9]+\\\\.ndjson\\\\.gz';`;
  });
  return `-- Snowflake: load Dispatch's daily S3 exports with Snowpipe.
-- 1. A storage integration for the bucket (once, by an ACCOUNTADMIN). Give Snowflake's IAM user
--    (DESC INTEGRATION dispatch_s3 → STORAGE_AWS_IAM_USER_ARN / EXTERNAL_ID) read access to the bucket.
CREATE STORAGE INTEGRATION IF NOT EXISTS dispatch_s3
  TYPE = EXTERNAL_STAGE STORAGE_PROVIDER = 'S3' ENABLED = TRUE
  STORAGE_AWS_ROLE_ARN = '<arn:aws:iam::ACCOUNT:role/snowflake-dispatch-read>'
  STORAGE_ALLOWED_LOCATIONS = ('${root}/');

CREATE FILE FORMAT IF NOT EXISTS dispatch_ndjson TYPE = JSON COMPRESSION = GZIP STRIP_OUTER_ARRAY = FALSE;
CREATE STAGE IF NOT EXISTS dispatch_stage URL = '${root}/' STORAGE_INTEGRATION = dispatch_s3 FILE_FORMAT = dispatch_ndjson;

-- 2. Tables and pipes (one per export type)
${tables.join("\n\n")}

-- 3. Point the bucket's "object created" notifications at the pipes' queue:
--    SHOW PIPES LIKE 'dispatch_%';  → notification_channel (an SQS ARN) → S3 event notification for prefix ${root.replace(/^s3:\/\/[^/]+\//, "")}/
-- Backfill files that already exist:  ALTER PIPE dispatch_events_pipe REFRESH;  (and the other pipes)
`;
}

function redshift(root: string, region: string): string {
  const typ = (c: Col) => (c.type === "json" ? "SUPER" : c.type === "timestamp" ? "TIMESTAMP" : c.type === "int" ? "INTEGER" : "VARCHAR(65535)");
  // 'auto ignorecase' matches JSON keys to columns ignoring case only: contactId → contactid
  const tables = WAREHOUSE_TYPES.map((t) => `CREATE TABLE IF NOT EXISTS dispatch_${t} (
  ${EXPORT_COLUMNS[t].map((c) => `${c.name.toLowerCase()} ${typ(c)}`).join(",\n  ")}
);`);
  const copies = WAREHOUSE_TYPES.map((t) => `COPY dispatch_${t}
FROM '${root}/${t}/daily-{{ ds }}/part-'
IAM_ROLE '<arn:aws:iam::ACCOUNT:role/redshift-dispatch-read>'
FORMAT JSON 'auto ignorecase' GZIP TIMEFORMAT 'auto' REGION '${region}';`);
  return `-- Redshift: tables for Dispatch's daily S3 exports.
-- Column names are the JSON keys lowercased, which is how 'auto ignorecase' matches them.
${tables.join("\n\n")}

-- Daily load: run after 01:00 UTC (the export lands shortly after midnight).
-- {{ ds }} = yesterday's date, YYYY-MM-DD (Airflow / dbt / Redshift scheduled query variable).
${copies.join("\n\n")}

-- Redshift Serverless or provisioned both work; the IAM role needs s3:GetObject + s3:ListBucket on ${root}/*.
`;
}

function bigquery(root: string): string {
  const typ = (c: Col) => (c.type === "json" ? "JSON" : c.type === "timestamp" ? "TIMESTAMP" : c.type === "int" ? "INT64" : "STRING");
  const schemas = WAREHOUSE_TYPES.map((t) => `CREATE TABLE IF NOT EXISTS dispatch.${t} (
  ${EXPORT_COLUMNS[t].map((c) => `${c.name} ${typ(c)}`).join(",\n  ")}
)
PARTITION BY DATE(createdAt);`);
  const transfers = WAREHOUSE_TYPES.map((t) => `bq mk --transfer_config --data_source=amazon_s3 --target_dataset=dispatch \\
  --display_name='Dispatch ${t}' --schedule='every day 02:00' \\
  --params='{"destination_table_name_template":"${t}","data_path":"${root}/${t}/daily-{run_time-24h|\\"%Y-%m-%d\\"}/*.ndjson.gz","file_format":"JSON","access_key_id":"<AWS_ACCESS_KEY_ID>","secret_access_key":"<AWS_SECRET_ACCESS_KEY>","write_disposition":"APPEND"}'`);
  return `-- BigQuery: tables (keep the camelCase names so the NDJSON loads as-is), partitioned by day.
CREATE SCHEMA IF NOT EXISTS dispatch;
${schemas.join("\n\n")}

# Daily loads with the BigQuery Data Transfer Service for Amazon S3 (gzip NDJSON is supported).
# Use an AWS key with read-only access to ${root}/*.
${transfers.join("\n\n")}
`;
}
