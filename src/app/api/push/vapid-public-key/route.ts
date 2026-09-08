import { NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/settings";

export async function GET() {
  const keys = await getVapidKeys();
  if (!keys) return NextResponse.json({ error: "web push not configured" }, { status: 404 });
  return NextResponse.json({ publicKey: keys.publicKey });
}
