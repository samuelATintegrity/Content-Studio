import "server-only";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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

export async function putBytes(args: {
  key: string;
  body: Uint8Array;
  contentType: string;
}): Promise<string> {
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    throw new Error("R2_BUCKET and R2_PUBLIC_URL must be set");
  }
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      ContentLength: args.body.byteLength,
    }),
  );
  return `${publicUrl.replace(/\/$/, "")}/${args.key}`;
}
