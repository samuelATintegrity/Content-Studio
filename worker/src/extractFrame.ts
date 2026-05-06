// Last-frame extraction for the Funny Commercial v2 storyboard.
//
// Given an mp4 URL, downloads the file, ffmpeg-extracts the very last
// frame as a JPEG, uploads it to R2 under a SHA-keyed path, returns the
// public URL. The storyboard panel calls this immediately after Veo
// 3.1 returns a clip so the next actor shot can seed continuity from
// the prior shot's final pose.
//
// Mirrors the structure of cache.ts (R2 client + sha key + public URL
// return) and the ffmpeg-frame-extraction pattern from tag.ts (mkdtemp
// + spawn ffmpeg + read bytes).

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let _r2: S3Client | null = null;
function r2(): S3Client {
  if (_r2) return _r2;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET must all be set");
  }
  _r2 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _r2;
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-1500)}`));
    });
  });
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed (${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFile } = await import("node:fs/promises");
  await writeFile(dest, buf);
}

// Extract the last frame of an mp4 to a JPEG. `-sseof -0.1` seeks to
// 0.1s before the end, then `-frames:v 1` grabs one frame. We avoid
// `-sseof -1` which can land on a black tail-frame for some encoders.
export async function extractLastFrameLocal(mp4Path: string, outPath: string): Promise<void> {
  await runFfmpeg(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-sseof",
      "-0.1",
      "-i",
      mp4Path,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outPath,
    ],
    process.cwd(),
  );
}

// End-to-end: download the source mp4, ffmpeg-extract the last frame,
// upload the jpeg to R2, return its public URL.
export async function extractAndUploadLastFrame(sourceUrl: string): Promise<string> {
  if (!sourceUrl) throw new Error("extractAndUploadLastFrame: sourceUrl required");
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!bucket || !publicUrl) {
    throw new Error("R2_BUCKET and R2_PUBLIC_URL must be set");
  }

  const dir = await mkdtemp(join(tmpdir(), "fc-frame-"));
  const videoPath = join(dir, "in.mp4");
  const framePath = join(dir, "last.jpg");
  try {
    await fetchToFile(sourceUrl, videoPath);
    await extractLastFrameLocal(videoPath, framePath);
    const bytes = await readFile(framePath);
    const hash = createHash("sha256")
      .update(sourceUrl)
      .update(":lastframe")
      .digest("hex")
      .slice(0, 32);
    const key = `library/fc-shots/${hash}-lastframe.jpg`;
    await r2().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: "image/jpeg",
        ContentLength: bytes.length,
      }),
    );
    return `${publicUrl.replace(/\/$/, "")}/${key}`;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
