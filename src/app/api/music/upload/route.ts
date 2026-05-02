import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { putBytes } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — generous for an mp3

const NO_TRANSFORM_HEADERS = {
  "cache-control": "no-store, no-transform",
  "content-encoding": "identity",
};

// Upload an mp3 to R2 under the music/ prefix. The worker lists this
// prefix at render time, so dropping a file here is enough — no worker
// redeploy needed. Keying on the file's SHA-256 makes re-uploads
// idempotent (same R2 URL).
export async function POST(req: Request) {
  try {
    const filename = req.headers.get("x-filename") ?? "track.mp3";
    const contentType = req.headers.get("content-type") ?? "audio/mpeg";
    if (!contentType.startsWith("audio/")) {
      return NextResponse.json(
        { error: "content-type must be audio/*" },
        { status: 400, headers: NO_TRANSFORM_HEADERS },
      );
    }

    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json(
        { error: "empty body" },
        { status: 400, headers: NO_TRANSFORM_HEADERS },
      );
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "file too large (>25MB)" },
        { status: 413, headers: NO_TRANSFORM_HEADERS },
      );
    }

    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const key = `music/${hash}.mp3`;

    const cachedUrl = await putBytes({ key, body: buf, contentType: "audio/mpeg" });

    return NextResponse.json(
      { cachedUrl, filename, key },
      { headers: NO_TRANSFORM_HEADERS },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: NO_TRANSFORM_HEADERS },
    );
  }
}
