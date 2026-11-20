/**
 * Wipe all workspace data: contacts, devices, messages, events, campaigns, journeys,
 * segments, templates, content, settings, API keys and the job queue.
 * Keeps console accounts (User) and the migration history. Cannot be undone.
 *
 *   npx tsx scripts/reset-data.ts --yes
 *
 * Uses DATABASE_URL. Stop the worker first, or restart it afterwards.
 */
import "dotenv/config";
import { db } from "../src/lib/db";

const KEEP = new Set(["User", "_prisma_migrations"]);

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes. This deletes all workspace data except console accounts.");
    process.exitCode = 1;
    return;
  }
  const rows = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const tables = rows.map((r) => r.tablename).filter((t) => !KEEP.has(t));
  if (!tables.length) return console.log("Nothing to delete.");
  // CASCADE stays inside the list: User has no foreign keys pointing at workspace tables
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.replace(/"/g, '""')}"`).join(", ")} RESTART IDENTITY CASCADE`);
  const users = await db.user.count();
  console.log(`Deleted all rows from ${tables.length} tables. Kept ${users} console account(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
