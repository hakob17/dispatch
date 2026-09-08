import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.mediaAsset.delete({ where: { id } });
  try {
    await unlink(path.join(process.cwd(), "public", asset.path));
  } catch {}
  return NextResponse.json({ ok: true });
}
