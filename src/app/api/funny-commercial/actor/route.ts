import { NextResponse } from "next/server";
import { generateFcImage } from "@/lib/fal";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/funny-commercial/actor
// Generate a canonical actor portrait via Nano Banana 2. Returns
// { url } — the URL becomes the actor's referenceImageUrl that's
// passed to every subsequent shot composition for face consistency.
//
// The body's `prompt` is wrapped with portrait/face guidance so the
// generated image is suitable as a reference (head + shoulders, neutral
// expression, even lighting). The user-typed prompt provides the
// demographic / styling specifics.

interface Body {
  prompt: string;
}

const PORTRAIT_FRAME =
  "head and shoulders portrait facing slightly toward camera, neutral confident expression, even soft studio lighting, neutral seamless backdrop";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    const composed = `${prompt}. ${PORTRAIT_FRAME}`;
    const { url } = await generateFcImage({ prompt: composed, aspectRatio: "9:16" });
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
