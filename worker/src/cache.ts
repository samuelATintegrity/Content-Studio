// Mirror a fal.ai-hosted clip or image into our own R2 bucket so it's
// retrievable indefinitely (fal.ai's CDN URLs are signed and eventually
// expire). The R2 key is derived from the SHA-256 of the source URL so
// re-saving the same fal URL is idempotent.

import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let _client: S3Client | null = null;

function client(): S3Client {
  if (_client) return _client;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET must all be set");
  }
  _client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

function sniffExtension(kind: "image" | "video", contentType: string | null): string {
  const ct = (contentType ?? "").toLowerCase();
  if (kind === "video") {
    if (ct.includes("webm")) return "webm";
    return "mp4";
  }
  // image
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  return "jpg";
}

function sniffMimeType(kind: "image" | "video", contentType: string | null, ext: string): string {
  if (contentType && contentType.startsWith(kind === "video" ? "video/" : "image/")) {
    return contentType;
  }
  if (kind === "video") return ext === "webm" ? "video/webm" : "video/mp4";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

export async function cacheClip(sourceUrl: string, kind: "image" | "video"): Promise<string> {
  if (!sourceUrl) throw new Error("cacheClip: sourceUrl required");
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    throw new Error("R2_BUCKET and R2_PUBLIC_URL must be set");
  }

  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch source ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const contentType = res.headers.get("content-type");
  const ext = sniffExtension(kind, contentType);
  const mime = sniffMimeType(kind, contentType, ext);

  const hash = createHash("sha256").update(sourceUrl).digest("hex").slice(0, 32);
  const key = `cache/${kind}/${hash}.${ext}`;

  const arrayBuffer = await res.arrayBuffer();
  const body = Buffer.from(arrayBuffer);

  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: mime,
      ContentLength: body.length,
      // Cache items are reusable across batches — no Content-Disposition
      // override; the browser plays them inline (videos in <video>, images
      // via <img>). The render pipeline downloads via fetch regardless.
    }),
  );

  return `${publicUrl.replace(/\/$/, "")}/${key}`;
}
