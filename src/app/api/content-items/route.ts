import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recommendForContacts } from "@/lib/recommend";

/** Console: newest catalog articles plus the current non-personal trending list. */
export async function GET() {
  const [items, total, trending] = await Promise.all([
    db.contentItem.findMany({ orderBy: { publishedAt: "desc" }, take: 30 }),
    db.contentItem.count(),
    recommendForContacts([{ id: "console-preview" }], { strategy: "trending", limit: 5 }),
  ]);
  return NextResponse.json({ total, items, trending: trending.get("console-preview") ?? [] });
}
