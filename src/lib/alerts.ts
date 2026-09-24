import { db } from "./db";
import { getSetting } from "./settings";

/**
 * Integration alerts (RFP 10.3): when a webhook endpoint, a push/email provider or a content
 * feed keeps failing, open an alert, show it in the console and notify the team; resolve it
 * automatically on the next success.
 *
 * Notifications go to a Slack/Teams-compatible incoming webhook — Settings → Integration health,
 * or ALERT_WEBHOOK_URL — at most once per alert per ALERT_RENOTIFY_MINUTES (default 60).
 * On AWS the same failures also drive CloudWatch alarms (infra/aws/monitoring.tf).
 */
export type AlertSource = "WEBHOOK" | "PROVIDER" | "FEED";

export interface AlertInput {
  key: string;
  source: AlertSource;
  severity?: "WARNING" | "CRITICAL";
  title: string;
  detail?: string;
}

/** Open (or bump) an alert. Never throws — alerting must not break the failing path further. */
export async function raiseAlert(a: AlertInput): Promise<void> {
  try {
    const open = await db.systemAlert.findFirst({ where: { key: a.key, resolvedAt: null } });
    const alert = open
      ? await db.systemAlert.update({
          where: { id: open.id },
          data: {
            count: { increment: 1 },
            lastAt: new Date(),
            detail: a.detail?.slice(0, 1000) ?? open.detail,
            title: a.title,
            // escalate, never downgrade
            ...(a.severity === "CRITICAL" ? { severity: "CRITICAL" } : {}),
          },
        })
      : await db.systemAlert.create({
          data: { key: a.key, source: a.source, severity: a.severity ?? "WARNING", title: a.title, detail: a.detail?.slice(0, 1000) },
        });
    const renotifyMs = (Number(process.env.ALERT_RENOTIFY_MINUTES) || 60) * 60_000;
    const escalated = a.severity === "CRITICAL" && open?.severity !== "CRITICAL";
    if (!alert.notifiedAt || escalated || Date.now() - alert.notifiedAt.getTime() > renotifyMs) {
      if (await notify(`${alert.severity === "CRITICAL" ? "🔴" : "🟠"} Dispatch: ${alert.title}`, alert.detail ?? undefined)) {
        await db.systemAlert.update({ where: { id: alert.id }, data: { notifiedAt: new Date() } });
      }
    }
  } catch (err) {
    console.error("[alerts] raise failed:", err);
  }
}

/** Close the open alert for this key, if any (called on success paths — cheap when none is open). */
export async function resolveAlert(key: string, note?: string): Promise<void> {
  try {
    const { count } = await db.systemAlert.updateMany({ where: { key, resolvedAt: null }, data: { resolvedAt: new Date() } });
    if (count && note) await notify(`✅ Dispatch: ${note}`);
  } catch (err) {
    console.error("[alerts] resolve failed:", err);
  }
}

export async function alertWebhookUrl(): Promise<string | null> {
  return (await getSetting<string>("alerts.webhookUrl")) || process.env.ALERT_WEBHOOK_URL || null;
}

/** Slack and Microsoft Teams (incoming webhook / workflow) both accept `{ text }`. */
async function notify(text: string, detail?: string): Promise<boolean> {
  const url = await alertWebhookUrl();
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: detail ? `${text}\n${detail}` : text }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ policies

/** Consecutive webhook failures before alerting, and before the endpoint is switched off. */
export const WEBHOOK_ALERT_AFTER = Number(process.env.WEBHOOK_ALERT_AFTER_FAILURES) || 5;
export const WEBHOOK_DISABLE_AFTER = Number(process.env.WEBHOOK_DISABLE_AFTER_FAILURES) || 100;

export async function webhookFailed(ep: { id: string; name: string; url: string }, failureCount: number, error: string): Promise<void> {
  if (failureCount >= WEBHOOK_DISABLE_AFTER) {
    await db.webhookEndpoint.update({ where: { id: ep.id }, data: { isActive: false } });
    await raiseAlert({
      key: `webhook:${ep.id}`,
      source: "WEBHOOK",
      severity: "CRITICAL",
      title: `Webhook "${ep.name}" disabled after ${failureCount} failed deliveries`,
      detail: `${ep.url} — last error: ${error}. Fix the receiver, then re-enable it under Settings → Webhooks.`,
    });
  } else if (failureCount >= WEBHOOK_ALERT_AFTER) {
    await raiseAlert({
      key: `webhook:${ep.id}`,
      source: "WEBHOOK",
      title: `Webhook "${ep.name}" is failing (${failureCount} in a row)`,
      detail: `${ep.url} — last error: ${error}. Deliveries are retried; it is disabled after ${WEBHOOK_DISABLE_AFTER} consecutive failures.`,
    });
  }
}

/**
 * Provider health from one send batch: alert when most messages failed for provider-side
 * reasons (bad credentials, outage). Dead tokens and bad addresses don't count.
 */
export async function providerBatchOutcome(channel: string, sent: number, providerFailures: number, sampleError?: string): Promise<void> {
  const key = `provider:${channel}`;
  const total = sent + providerFailures;
  if (providerFailures >= 5 && providerFailures / total >= 0.5) {
    await raiseAlert({
      key,
      source: "PROVIDER",
      severity: sent === 0 ? "CRITICAL" : "WARNING",
      title: `${channel} sends are failing (${providerFailures} of ${total} in the last batch)`,
      detail: `Last error: ${sampleError ?? "unknown"}. Check the credentials under Settings, and the provider's status page.`,
    });
  } else if (sent > 0) {
    await resolveAlert(key, `${channel} sends are succeeding again`);
  }
}
