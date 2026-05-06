import { NextResponse } from "next/server";
import { generateFcImage } from "@/lib/fal";

export const runtime = "nodejs";
export const maxDuration = 90;

// POST /api/funny-commercial/shot/image
// Compose a shot's first-frame still via Nano Banana 2 with optional
// reference images:
//   - actorReferenceUrl: the actor's canonical portrait — Nano edits
//     the same face into the new scene.
//   - locationImageUrl: a saved location backdrop — Nano edits the
//     subject INTO this exact backdrop.
// Either reference may be omitted. When both are present the model
// blends both; when only one is present that one is used.
//
// Used for both kinds of shots:
//   actor shot → actorReferenceUrl + (optional) locationImageUrl
//   crazy shot → (optional) locationImageUrl only; absurd subject is
//                described in the prompt
//
// The Claude-written animation prompt is generated client-side
// AFTER this image is accepted (see writeFcAnimationPrompt) — keeping
// it separate lets the user re-roll the image without re-spending a
// Claude call on the animation direction.

interface Body {
  prompt: string;
  actorReferenceUrl?: string;
  locationImageUrl?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    const referenceImageUrls: string[] = [];
    if (body.actorReferenceUrl) referenceImageUrls.push(body.actorReferenceUrl);
    if (body.locationImageUrl) referenceImageUrls.push(body.locationImageUrl);

    const { url } = await generateFcImage({
      prompt,
      referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
      aspectRatio: "9:16",
    });
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
