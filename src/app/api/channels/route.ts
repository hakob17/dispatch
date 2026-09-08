import { NextResponse } from "next/server";
import { getChannelStatus } from "@/lib/channels";

export async function GET() {
  return NextResponse.json(await getChannelStatus());
}
