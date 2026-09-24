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

/**
 * FCM service account. Order: FCM_SERVICE_ACCOUNT_JSON (e.g. injected from AWS
 * Secrets Manager into the ECS task), FCM_SERVICE_ACCOUNT_PATH, then the
 * DB-stored JSON uploaded on the Settings page.
 */
export async function getFcmServiceAccount(): Promise<Record<string, unknown> | null> {
  if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
    } catch {
      console.error("[settings] FCM_SERVICE_ACCOUNT_JSON is not valid JSON");
      return null;
    }
  }
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

export interface ApnsConfig {
  keyId: string;
  teamId: string;
  bundleId: string; // apns-topic
  privateKey: string; // contents of the AuthKey_XXXX.p8 file
  production: boolean;
}

/** APNs token-auth config: APNS_* env vars (Secrets Manager) win over the Settings page. */
export async function getApnsConfig(): Promise<ApnsConfig | null> {
  if (process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_BUNDLE_ID && process.env.APNS_PRIVATE_KEY) {
    return {
      keyId: process.env.APNS_KEY_ID,
      teamId: process.env.APNS_TEAM_ID,
      bundleId: process.env.APNS_BUNDLE_ID,
      privateKey: process.env.APNS_PRIVATE_KEY.replace(/\\n/g, "\n"),
      production: process.env.APNS_PRODUCTION !== "false",
    };
  }
  const stored = await getSetting<ApnsConfig>("apns");
  return stored?.keyId && stored.teamId && stored.bundleId && stored.privateKey ? stored : null;
}
