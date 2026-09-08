import { NextRequest, NextResponse } from "next/server";
import { MessageStatus, Channel } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Activity logs.
 * GET ?type=messages&status=&channel=&page=1
 * GET ?type=events&name=&page=1
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const type = p.get("type") ?? "messages";
  const page = Math.max(1, Number(p.get("page")) || 1);
  const pageSize = 50;

  if (type === "events") {
    const name = p.get("name") || undefined;
    const where = name ? { name: { contains: name, mode: "insensitive" as const } } : {};
    const [rows, total, names] = await Promise.all([
      db.contactEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { contact: { select: { id: true, email: true } } },
      }),
      db.contactEvent.count({ where }),
      db.contactEvent.groupBy({ by: ["name"], _count: true, orderBy: { _count: { name: "desc" } }, take: 20 }),
    ]);
    return NextResponse.json({ rows, total, page, pageSize, names });
  }

  const status = p.get("status") as MessageStatus | null;
  const channel = p.get("channel") as Channel | null;
  const where = {
    ...(status ? { status } : {}),
    ...(channel ? { channel } : {}),
  };
  const [rows, total] = await Promise.all([
    db.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        contact: { select: { id: true, email: true } },
        campaign: { select: { id: true, name: true } },
        journeyStep: { select: { journey: { select: { id: true, name: true } } } },
      },
    }),
    db.message.count({ where }),
  ]);
  return NextResponse.json({ rows, total, page, pageSize });
}
