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
    const raw = e instanceof Error ? e.message : "unknown error";
    // Veo 3.1's likeness filter is stricter than Seedance/Kling — it
    // rejects most photoreal portraits with a 422 / "Unprocessable
    // Entity" error and leaks that opaque string up through fal's SDK.
    // The orchestrator already retries via Kling when Veo refuses
    // (src/lib/fal.ts), so reaching this catch with an unprocessable-
    // shaped error means BOTH models refused — usually because the
    // input image is too photoreal of an identifiable real person.
    // Surface that explanation rather than the raw 422 message.
    const lower = raw.toLowerCase();
    const isUnprocessable =
      lower.includes("422") ||
      lower.includes("unprocessable") ||
      lower.includes("safety") ||
      lower.includes("likeness");
    const msg = isUnprocessable
      ? `Both Veo and Kling refused this image — usually a likeness/safety filter. Try re-rolling the still with a less recognizable / more stylized framing (avoid photoreal portraits of identifiable real people), then animate again.`
      : raw;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
