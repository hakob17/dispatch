import { db } from "./db";

/**
 * Configurable data retention (days). Unset = keep forever, except:
 *   AUDIT_RETENTION_DAYS  default 400 (≥ 1 year for compliance audits)
 *   JOB_RETENTION_DAYS    default 7   (finished queue rows)
 */
export function retentionConfig() {
  const days = (name: string, fallback: number | null) => {
    const v = Number(process.env[name]);
    return v > 0 ? v : fallback;
  };
  return {
    messages: days("MESSAGE_RETENTION_DAYS", null),
    events: days("EVENT_RETENTION_DAYS", null),
    audit: days("AUDIT_RETENTION_DAYS", 400),
    jobs: days("JOB_RETENTION_DAYS", 7),
  };
}

const ago = (d: number) => new Date(Date.now() - d * 86400_000);

export async function runRetention(): Promise<void> {
  const cfg = retentionConfig();
  const removed: Record<string, number> = {};
  if (cfg.jobs) {
    removed.jobs = (await db.job.deleteMany({ where: { status: { in: ["DONE", "FAILED"] }, createdAt: { lt: ago(cfg.jobs) } } })).count;
  }
  if (cfg.audit) removed.audit = (await db.auditLog.deleteMany({ where: { createdAt: { lt: ago(cfg.audit) } } })).count;
  if (cfg.events) removed.events = (await db.contactEvent.deleteMany({ where: { createdAt: { lt: ago(cfg.events) } } })).count;
  if (cfg.messages) {
    // MessageEvents cascade with their Message
    removed.messages = (await db.message.deleteMany({ where: { createdAt: { lt: ago(cfg.messages) } } })).count;
  }
  if (Object.values(removed).some((n) => n > 0)) console.log("[retention] purged", removed);
}
