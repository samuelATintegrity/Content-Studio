import { NextResponse } from "next/server";
import { generateFcImage } from "@/lib/fal";

export const runtime = "nodejs";
export const maxDuration = 90;

// POST /api/story/frame/generate
//
// Pure text-to-image first-frame generator. No reference images, no
// actor / location plumbing — Story Builder dropped both concepts.
// Returns { url } pointing at a fal.ai-hosted PNG that the wizard
// presents for keep / retry / discard.
//
// `generateFcImage` is shared with the rest of the app (Nano Banana 2,
// 9:16 aspect ratio). The name kept its `Fc` prefix from the prior FC
// flow but the function itself is generic — no FC-specific behavior.

interface Body {
  prompt: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    const { url } = await generateFcImage({ prompt, aspectRatio: "9:16" });
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
