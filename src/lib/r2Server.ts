import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";

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

// Convert a public R2 URL back into the S3 key it lives at, by stripping
// the R2_PUBLIC_URL prefix. Returns null if the URL isn't from this bucket.
export function keyFromPublicUrl(url: string): string | null {
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) return null;
  const prefix = publicUrl.replace(/\/$/, "") + "/";
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

export async function deleteKey(key: string): Promise<void> {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET must be set");
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Read an R2 object as raw bytes. Returns null when the key doesn't exist
// (so callers can distinguish "not yet written" from "fetch error"). Other
// S3 errors propagate.
export async function getObjectBytes(key: string): Promise<Uint8Array | null> {
  const bucket = process.env.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET must be set");
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!res.Body) return null;
    return await res.Body.transformToByteArray();
  } catch (e) {
    if (e instanceof NoSuchKey) return null;
    // S3 occasionally raises a generic "NotFound" instead of NoSuchKey.
    if (e && typeof e === "object" && "name" in e) {
      const name = (e as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
    }
    throw e;
  }
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
