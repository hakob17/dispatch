import { cookies } from "next/headers";
import { db } from "./db";
import { SESSION_COOKIE, SessionPayload, verifySessionToken } from "./session";

export { hashPassword, verifyPassword } from "./password";

/** Current session from the request cookie (route handlers / server components). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireAdmin(): Promise<SessionPayload | null> {
  const session = await getSession();
  return session?.role === "ADMIN" ? session : null;
}

export async function anyUsersExist(): Promise<boolean> {
  return (await db.user.count()) > 0;
}
