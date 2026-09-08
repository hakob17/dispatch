import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verify } from "@/lib/tracking/sign";

export async function GET(req: NextRequest) {
  const m = req.nextUrl.searchParams.get("m") || "";
  const u = req.nextUrl.searchParams.get("u") || "";
  const s = req.nextUrl.searchParams.get("s") || "";

  if (!u || !/^https?:\/\//.test(u)) {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  // Only track (and only redirect to) properly signed links — the signature
  // covers the destination, so this is not an open redirect.
  if (!(m && s && verify(m + "|" + u, s))) {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    const msg = await db.message.findUnique({ where: { id: m }, select: { id: true, clickedAt: true } });
    if (msg) {
      await db.messageEvent.create({ data: { messageId: m, type: "CLICK", meta: { url: u } } });
      if (!msg.clickedAt) {
        await db.message.update({ where: { id: m }, data: { clickedAt: new Date() } });
      }
    }
  } catch {}

  return NextResponse.redirect(u, 302);
}
