import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verify } from "@/lib/tracking/sign";

// 1x1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(req: NextRequest) {
  const m = req.nextUrl.searchParams.get("m") || "";
  const s = req.nextUrl.searchParams.get("s") || "";
  if (m && s && verify(m, s)) {
    // Fire-and-forget; never block or fail the pixel
    try {
      const msg = await db.message.findUnique({ where: { id: m }, select: { id: true, openedAt: true } });
      if (msg) {
        await db.messageEvent.create({
          data: { messageId: m, type: "OPEN", meta: { ua: req.headers.get("user-agent") ?? "" } },
        });
        if (!msg.openedAt) {
          await db.message.update({ where: { id: m }, data: { openedAt: new Date() } });
        }
      }
    } catch {}
  }
  return new NextResponse(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" },
  });
}
