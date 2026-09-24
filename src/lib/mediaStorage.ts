import path from "path";
import { mkdir, unlink, writeFile } from "fs/promises";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Where uploaded images live. On AWS (MEDIA_S3_BUCKET set) they go to S3 and
 * are served from MEDIA_PUBLIC_BASE_URL (CloudFront or the bucket URL) — the
 * container filesystem is ephemeral and not shared between ECS tasks.
 * Locally they fall back to public/uploads.
 */
const LOCAL_DIR = path.join(process.cwd(), "public", "uploads");

let client: S3Client | null = null;
const s3 = () => (client ??= new S3Client({ region: process.env.MEDIA_S3_REGION || process.env.AWS_REGION }));

function s3Config() {
  const bucket = process.env.MEDIA_S3_BUCKET;
  if (!bucket) return null;
  const base = (process.env.MEDIA_PUBLIC_BASE_URL || `https://${bucket}.s3.amazonaws.com`).replace(/\/+$/, "");
  const prefix = (process.env.MEDIA_S3_PREFIX || "media").replace(/^\/+|\/+$/g, "");
  return { bucket, base, prefix };
}

/** Store a file; returns the URL (absolute for S3, site-relative locally) saved on the MediaAsset. */
export async function putMedia(filename: string, body: Buffer, contentType: string): Promise<string> {
  const cfg = s3Config();
  if (cfg) {
    const key = `${cfg.prefix}/${filename}`;
    await s3().send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    return `${cfg.base}/${key}`;
  }
  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, filename), body);
  return `/uploads/${filename}`;
}

export async function deleteMedia(url: string): Promise<void> {
  const cfg = s3Config();
  try {
    if (cfg && url.startsWith(cfg.base + "/")) {
      await s3().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: url.slice(cfg.base.length + 1) }));
    } else if (url.startsWith("/uploads/")) {
      await unlink(path.join(process.cwd(), "public", url));
    }
  } catch {}
}
