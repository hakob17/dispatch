import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { putMedia } from "@/lib/mediaStorage";

// No SVG: it can carry script, and APNs/FCM rich push doesn't render it anyway
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function GET() {
  const assets = await db.mediaAsset.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(assets);
}

/** multipart/form-data upload with a `file` field. */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file field required" }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: `unsupported type ${file.type}` }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "max 5 MB" }, { status: 400 });

  const ext = path.extname(file.name) || `.${file.type.split("/")[1]}`;
  const filename = `${nanoid(10)}${ext}`;
  const url = await putMedia(filename, Buffer.from(await file.arrayBuffer()), file.type);

  const asset = await db.mediaAsset.create({
    data: { filename: file.name, path: url, mime: file.type, size: file.size },
  });
  return NextResponse.json(asset, { status: 201 });
}
