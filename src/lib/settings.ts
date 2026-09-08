import { db } from "./db";

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as object },
    update: { value: value as object },
  });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.setting.deleteMany({ where: { key } });
}

/** VAPID keys: env vars win over DB-stored keys. */
export async function getVapidKeys(): Promise<{
  publicKey: string;
  privateKey: string;
  subject: string;
} | null> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    };
  }
  const stored = await getSetting<{ publicKey: string; privateKey: string }>("vapid");
  if (!stored) return null;
  return {
    ...stored,
    subject: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  };
}

/** FCM service account: file path env var wins over DB-stored JSON. */
export async function getFcmServiceAccount(): Promise<Record<string, unknown> | null> {
  const path = process.env.FCM_SERVICE_ACCOUNT_PATH;
  if (path) {
    try {
      const { readFileSync } = await import("fs");
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return null;
    }
  }
  return getSetting<Record<string, unknown>>("fcmServiceAccount");
}
