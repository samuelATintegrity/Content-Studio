import { NextResponse } from "next/server";
import { animateImage } from "@/lib/fal";
import { extractLastFrameViaWorker } from "@/lib/railwayClient";

export const runtime = "nodejs";
// Kling v3 Pro typically returns in ~90-120s. The previous Veo path
// could chain three 60s 422-retries before falling back to Kling and
// blow past the 300s cap, leaving successful renders stranded in
// fal.ai with the route returning 504. Defaulting to Kling cuts the
// budget by 2-3x and the user gets the clip back reliably.
export const maxDuration = 240;

// POST /api/funny-commercial/shot/animate
// Animate a still to a 5s clip via Kling v3 Pro (no documented face
// restriction; produces silent video — the FC flow stopped relying on
// diegetic audio when we moved off Veo). After Kling returns, kick
// off a worker call to extract + cache the last frame so the next
// actor shot can seed continuity from it.
//
// Returns:
//   { videoUrl, lastFrameImageUrl? }
//
// lastFrameImageUrl may be undefined if extraction fails — the panel
// continues without continuity rather than failing the whole render.

interface Body {
  imageUrl: string;
  animationPrompt: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.imageUrl) {
      return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
    }
    const animationPrompt = body.animationPrompt?.trim();
    if (!animationPrompt) {
      return NextResponse.json({ error: "animationPrompt is required" }, { status: 400 });
    }
    const { url: videoUrl } = await animateImage(body.imageUrl, "kling", animationPrompt);

    // Best-effort last-frame extraction. We surface a warning header
    // if this fails so the client can decide whether to retry; the
    // animation result is still returned.
    let lastFrameImageUrl: string | undefined;
    try {
      lastFrameImageUrl = await extractLastFrameViaWorker({ url: videoUrl });
    } catch (e) {
      console.warn(
        "[fc/shot/animate] last-frame extraction failed (continuing without):",
        e instanceof Error ? e.message : String(e),
      );
    }

    return NextResponse.json({ videoUrl, lastFrameImageUrl });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "unknown error";
    // Kling has no documented face restriction so 422s are rare;
    // when they do happen it's typically a transient fal.ai issue
    // or a malformed image_url. Surface the raw error.
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
