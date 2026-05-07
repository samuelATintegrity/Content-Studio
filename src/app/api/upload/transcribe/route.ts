import { NextResponse } from "next/server";

export const runtime = "nodejs";
// Whisper handles 25MB max per request and typically transcribes a
// 60-90s video in 5-15s. Allow up to 5 min for longer uploads.
export const maxDuration = 300;

// POST /api/upload/transcribe
//
// Body: { url: string }
//
// Fetches the file at `url` (an R2-hosted upload from /api/video/
// upload-clip) and ships it to OpenAI's Whisper API. Returns
// { transcript: string }.
//
// Whisper accepts video files directly — it strips the audio track
// internally — so we don't need a separate audio-extraction step.
// 25MB is Whisper's per-request hard limit; longer / larger files
// will need chunking, but Story Builder shorts are well under it.

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";
const MAX_BYTES = 25 * 1024 * 1024; // Whisper's documented limit

interface Body {
  url: string;
  // Optional language hint. Accepts ISO-639-1 (en/tl/es/zh) — when
  // present, Whisper biases its decoder toward that language. Without
  // a hint Whisper auto-detects, which is fine but slightly slower
  // and occasionally wrong on short clips.
  language?: string;
}

function filenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "upload.mp4";
    return last;
  } catch {
    return "upload.mp4";
  }
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPEN_AI_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPEN_AI_KEY env var is not set" },
        { status: 500 },
      );
    }

    const body = (await req.json()) as Body;
    if (!body.url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    // Pull the bytes from R2 (or wherever the upload landed). Whisper
    // wants the bytes in a multipart form, not a URL.
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
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: "file exceeds Whisper's 25MB limit. Compress before uploading." },
        { status: 413 },
      );
    }

    const filename = filenameFromUrl(body.url);
    const contentType = fileRes.headers.get("content-type") ?? "video/mp4";

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    form.append("model", WHISPER_MODEL);
    // Plain-text response; we don't need word timings for caption drafts.
    form.append("response_format", "text");
    if (body.language) form.append("language", body.language);

    const res = await fetch(WHISPER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Whisper failed (${res.status}): ${text.slice(0, 300)}` },
        { status: 502 },
      );
    }

    // response_format: "text" returns plain text in the body; not JSON.
    const transcript = (await res.text()).trim();
    return NextResponse.json({ transcript });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
