import { NextRequest, NextResponse } from "next/server";
import { recordEngagement } from "@/lib/tracking/record";
import { verify } from "@/lib/tracking/sign";

// 1x1 transparent GIF
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(req: NextRequest) {
  const m = req.nextUrl.searchParams.get("m") || "";
  const s = req.nextUrl.searchParams.get("s") || "";
  if (m && s && verify(m, s)) {
    // Fire-and-forget; never block or fail the pixel
    try {
      await recordEngagement(m, "OPEN", { ua: req.headers.get("user-agent") ?? "" });
    } catch {}
  }
  return new NextResponse(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, max-age=0" },
  });
}
