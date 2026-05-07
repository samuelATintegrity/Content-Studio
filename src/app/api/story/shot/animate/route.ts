import { NextResponse } from "next/server";
import { animateImage } from "@/lib/fal";
import { extractLastFrameViaWorker } from "@/lib/railwayClient";

export const runtime = "nodejs";
// Kling v3 Pro typically returns in ~90-120s. The prior Veo path
// occasionally chained 60s 422-retries before falling back to Kling
// and blew past the 300s cap, leaving successful renders stranded
// in fal.ai with the route returning 504. Defaulting to Kling cuts
// the budget by 2-3x and the user gets the clip back reliably.
export const maxDuration = 240;

// POST /api/story/shot/animate
//
// Animate a starting-frame image to a clip via Kling v3 Pro. After
// Kling returns, kick off a worker call to extract + cache the last
// frame so the next shot can chain from it. The animation itself is
// silent — Story Builder's first cut doesn't render audio, just
// arranges clips on a Premiere XML timeline.
//
// Returns:
//   { videoUrl, lastFrameImageUrl? }
//
// `lastFrameImageUrl` may be undefined if extraction fails — the
// panel saves the shot without continuity rather than failing the
// whole render.

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

    let lastFrameImageUrl: string | undefined;
    try {
      lastFrameImageUrl = await extractLastFrameViaWorker({ url: videoUrl });
    } catch (e) {
      console.warn(
        "[story/shot/animate] last-frame extraction failed (continuing without):",
        e instanceof Error ? e.message : String(e),
      );
    }

    return NextResponse.json({ videoUrl, lastFrameImageUrl });
  } catch (e) {
    const raw = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
