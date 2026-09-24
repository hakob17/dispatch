import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Connection pool sizing. Prisma's default (2 × CPUs + 1) is too small for a
 * worker running WORKER_BATCH_SIZE jobs concurrently — jobs then time out
 * waiting for a connection. DB_POOL_SIZE / DB_POOL_TIMEOUT (seconds) override
 * whatever the DATABASE_URL carries. Keep tasks × pool size under the
 * database's max_connections.
 */
function datasourceUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw || (!process.env.DB_POOL_SIZE && !process.env.DB_POOL_TIMEOUT)) return undefined;
  const url = new URL(raw);
  if (process.env.DB_POOL_SIZE) url.searchParams.set("connection_limit", process.env.DB_POOL_SIZE);
  if (process.env.DB_POOL_TIMEOUT) url.searchParams.set("pool_timeout", process.env.DB_POOL_TIMEOUT);
  return url.toString();
}

export const db = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: datasourceUrl() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Retry a write that must not be lost (e.g. recording that a provider already
 * accepted a message). Retries connection-pool timeouts and dropped
 * connections with backoff; anything else is rethrown immediately.
 */
export async function durableWrite<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string }).code;
      const transient = code === "P2024" || code === "P1001" || code === "P1017" || code === "P2034";
      if (!transient || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, Math.min(8000, 250 * 2 ** i)));
    }
  }
}

/**
 * A JS Date as a UTC `timestamp` literal for raw SQL. Prisma stores DateTime
 * as UTC in `timestamp without time zone` columns, but a bare Date parameter
 * arrives as timestamptz and Postgres shifts it by the session's timezone.
 * Always use this (and `now() AT TIME ZONE 'UTC'`) in $queryRaw/$executeRaw.
 */
export function utcTs(d: Date | null | undefined): Prisma.Sql {
  return d ? Prisma.sql`${d.toISOString().replace("T", " ").replace("Z", "")}::timestamp` : Prisma.sql`NULL::timestamp`;
}
