import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

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

// Upload a local file to the R2 bucket and return its public URL.
// Sets Content-Disposition: attachment so the browser triggers a download
// when the URL is hit directly (matches the "⬇ Download" UX from static).
export async function uploadVideo(localPath: string, key: string): Promise<string> {
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    throw new Error("R2_BUCKET and R2_PUBLIC_URL must be set");
  }
  const s = client();
  const fileStat = await stat(localPath);
  await s.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPath),
      ContentType: "video/mp4",
      ContentLength: fileStat.size,
      ContentDisposition: `attachment; filename="${key.split("/").pop() ?? "video.mp4"}"`,
    }),
  );
  return `${publicUrl.replace(/\/$/, "")}/${key}`;
}
