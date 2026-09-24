import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteMedia } from "@/lib/mediaStorage";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.mediaAsset.delete({ where: { id } });
  await deleteMedia(asset.path);
  return NextResponse.json({ ok: true });
}
