import { NextResponse } from "next/server";
import { presignPut } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/upload/presign
//
// Body:
//   {
//     kind: "video" | "image",
//     contentType: string,    // exact MIME the browser will PUT
//     sha: string,             // sha-256 hex (32-char prefix is fine)
//     ext: string,             // file extension without dot (mp4, png, jpg, ...)
//   }
//
// Returns: { uploadUrl, publicUrl }
//
// The browser PUTs the file body straight to `uploadUrl` with the
// matching Content-Type header. Once the PUT succeeds, `publicUrl`
// is the stable readable URL — same key shape as the older direct-
// to-Vercel upload routes, so existing transcribe/describe routes
// just take it as input unchanged.

interface Body {
  kind: "video" | "image";
  contentType: string;
  sha: string;
  ext: string;
}

const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm", "avi"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (body.kind !== "video" && body.kind !== "image") {
      return NextResponse.json(
        { error: "kind must be 'video' or 'image'" },
        { status: 400 },
      );
    }
    if (!body.contentType || !body.sha || !body.ext) {
      return NextResponse.json(
        { error: "contentType, sha, and ext are required" },
        { status: 400 },
      );
    }
    // Sanitize the extension — no path separators, no dots, lowercase.
    const ext = body.ext.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (body.kind === "video" && !VIDEO_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `unsupported video extension: ${body.ext}` },
        { status: 400 },
      );
    }
    if (body.kind === "image" && !IMAGE_EXTS.has(ext)) {
      return NextResponse.json(
        { error: `unsupported image extension: ${body.ext}` },
        { status: 400 },
      );
    }
    // Sanitize sha — hex only, max 64 chars (32-char prefix is also fine).
    const sha = body.sha.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 64);
    if (sha.length < 16) {
      return NextResponse.json({ error: "sha must be a hex string" }, { status: 400 });
    }

    // Same key shape as the legacy direct-upload routes so anything
    // that reads from R2 by URL pattern keeps working.
    const key =
      body.kind === "video"
        ? `cache/upload/${sha}.${ext}`
        : `cache/upload-image/${sha}.${ext}`;

    const { uploadUrl, publicUrl } = await presignPut({
      key,
      contentType: body.contentType,
    });
    return NextResponse.json({ uploadUrl, publicUrl, key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
