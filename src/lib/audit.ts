import type { Prisma } from "@prisma/client";
import { db } from "./db";

export interface AuditEntry {
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  status?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Prisma.InputJsonValue;
}

/** Append to the audit trail. Never throws — auditing must not break the request. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({ data: { ...entry, userAgent: entry.userAgent?.slice(0, 500) } });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}

/**
 * "/api/campaigns/cmf123/launch" → { action: "/api/campaigns/:id/launch", entityType: "campaigns", entityId: "cmf123" }
 * Ids are cuid-like segments; everything else is kept literally.
 */
export function describePath(pathname: string): { route: string; entityType: string | null; entityId: string | null } {
  const parts = pathname.split("/").filter(Boolean);
  let entityId: string | null = null;
  const route = parts.map((p) => {
    if (/^c[a-z0-9]{20,}$/.test(p) || /^[0-9a-f-]{32,36}$/.test(p)) {
      entityId ??= p;
      return ":id";
    }
    return p;
  });
  return { route: "/" + route.join("/"), entityType: parts[1] ?? null, entityId };
}
