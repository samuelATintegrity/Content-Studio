import { NextResponse } from "next/server";
import { animateImage } from "@/lib/fal";
import { extractLastFrameViaWorker } from "@/lib/railwayClient";

export const runtime = "nodejs";
// Veo 3.1 image-to-video typically returns in 60-120s. Add headroom
// for the post-animation last-frame extraction round-trip.
export const maxDuration = 300;

// POST /api/funny-commercial/shot/animate
// Animate a still to a 5s clip via Veo 3.1 (which generates audio,
// important for the muffled-through-the-wall gag downstream), then
// kick off a worker call to extract + cache the last frame so the
// next actor shot can seed continuity from it.
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
    const { url: videoUrl } = await animateImage(body.imageUrl, "veo", animationPrompt);

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
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
