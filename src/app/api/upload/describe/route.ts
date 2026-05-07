import { NextResponse } from "next/server";
import { describeImageForCaption } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/upload/describe
//
// Body: { url: string }
//
// Fetches the image at `url` (typically R2-hosted from /api/story/
// frame/upload) and asks Claude Vision to describe what's in it. The
// returned `description` is fed into the caption drafter as the
// source signal — same role a Whisper transcript plays for video
// uploads.

interface Body {
  url: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const fileRes = await fetch(body.url);
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `source fetch failed: ${fileRes.status}` },
        { status: 502 },
      );
    }
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json({ error: "source is empty" }, { status: 400 });
    }
    const contentType = fileRes.headers.get("content-type") ?? "image/png";

    const description = await describeImageForCaption({
      imageBytes: bytes,
      contentType,
    });
    return NextResponse.json({ description });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
