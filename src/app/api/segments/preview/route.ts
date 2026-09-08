import { NextRequest, NextResponse } from "next/server";
import { countSegment, SegmentFilter } from "@/lib/segments/resolve";

export async function POST(req: NextRequest) {
  const { filters } = (await req.json()) as { filters: SegmentFilter[] };
  try {
    const count = await countSegment(filters || []);
    return NextResponse.json({ count });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 400 });
  }
}
