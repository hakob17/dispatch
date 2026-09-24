import { NextRequest, NextResponse } from "next/server";
import { recordEngagement } from "@/lib/tracking/record";
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
    await recordEngagement(m, "CLICK", { url: u });
  } catch {}

  return NextResponse.redirect(u, 302);
}
