import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { putBytes } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 60;
const DEPLOY_MARKER = "story-frame-upload-v1";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB — much more than a 9:16 still needs

// Some intermediary (likely Vercel's edge) compressed responses on the
// /api/video/upload-clip route without forwarding the Content-Encoding
// header, leaving the browser with raw compressed bytes. no-transform
// + identity content-encoding is the standard signal to leave the body
// alone. Mirroring that here preemptively.
const NO_TRANSFORM_HEADERS = {
  "cache-control": "no-store, no-transform",
  "content-encoding": "identity",
  "x-deploy-marker": DEPLOY_MARKER,
};

// POST /api/story/frame/upload
//
// Accepts a raw image body (jpeg / png / webp) keyed by sha-256 and
// mirrored to R2 under cache/upload-image/<sha>.<ext>. Returns the
// stable R2 URL — the client wraps it in a StoryStartingFrame and
// hands it to the animator.
//
// Pattern lifted from /api/video/upload-clip (raw body + x-filename)
// because that route has been battle-tested through enough Vercel
// quirks to make alternative pathways risky.

function extFromContentType(ct: string): string {
  if (ct.startsWith("image/png")) return "png";
  if (ct.startsWith("image/jpeg") || ct.startsWith("image/jpg")) return "jpg";
  if (ct.startsWith("image/webp")) return "webp";
  if (ct.startsWith("image/gif")) return "gif";
  // Fallback to png — most Nano outputs are png anyway.
  return "png";
}

export async function GET() {
  return NextResponse.json(
    { marker: DEPLOY_MARKER, accepts: "POST raw image body, x-filename header" },
    { headers: NO_TRANSFORM_HEADERS },
  );
}

export async function POST(req: Request) {
  try {
    const filename = req.headers.get("x-filename") ?? "upload.png";
    const contentType = req.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "content-type must be image/*" },
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
        { error: "image too large (>25MB)" },
        { status: 413, headers: NO_TRANSFORM_HEADERS },
      );
    }

    const ext = extFromContentType(contentType);
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const key = `cache/upload-image/${hash}.${ext}`;

    const cachedUrl = await putBytes({ key, body: buf, contentType });

    return NextResponse.json({ cachedUrl, filename }, { headers: NO_TRANSFORM_HEADERS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: msg, marker: DEPLOY_MARKER },
      { status: 500, headers: NO_TRANSFORM_HEADERS },
    );
  }
}
