import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retentionConfig } from "@/lib/retention";

// Admin-only (proxy: /api/settings/*).

/** GET ?user=&action=&page=1 — newest first. ?format=csv downloads the filtered log. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const page = Math.max(1, Number(p.get("page")) || 1);
  const pageSize = 50;
  const where = {
    ...(p.get("user") ? { userEmail: { contains: p.get("user")!, mode: "insensitive" as const } } : {}),
    ...(p.get("action") ? { action: { contains: p.get("action")!, mode: "insensitive" as const } } : {}),
  };

  if (p.get("format") === "csv") {
    const rows = await db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100_000 });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "createdAt,userEmail,action,entityType,entityId,status,ip,userAgent",
      ...rows.map((r) => [r.createdAt.toISOString(), r.userEmail, r.action, r.entityType, r.entityId, r.status, r.ip, r.userAgent].map(esc).join(",")),
    ].join("\n");
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="audit-log.csv"` },
    });
  }

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.count({ where }),
  ]);
  return NextResponse.json({ rows, total, page, pageSize, retentionDays: retentionConfig().audit });
}
