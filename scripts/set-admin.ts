/**
 * Create or reset a console admin and print a fresh random password.
 *
 *   npx tsx scripts/set-admin.ts [email]        (default admin@dispatch.local)
 *
 * Uses DATABASE_URL. Resetting also signs the account out everywhere (sessionVersion + 1).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/password";

async function main() {
  const email = (process.argv[2] || "admin@dispatch.local").toLowerCase();
  const password = randomBytes(15).toString("base64url"); // 20 characters
  const passwordHash = hashPassword(password);
  await db.user.upsert({
    where: { email },
    create: { email, name: "Admin", role: "ADMIN", passwordHash },
    update: { passwordHash, role: "ADMIN", sessionVersion: { increment: 1 } },
  });
  console.log(`Admin ready\n  email:    ${email}\n  password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
