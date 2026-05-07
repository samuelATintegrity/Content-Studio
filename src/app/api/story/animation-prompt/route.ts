import { NextResponse } from "next/server";
import { writeStoryAnimationPrompt } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/story/animation-prompt
//
// Optional "Write with AI" helper for the new-shot wizard. Takes a
// plain-English shot description and returns a short, filter-safe
// animation direction. The wizard pre-fills the user's shot description
// verbatim into the animation textarea — this endpoint only fires when
// the user explicitly clicks "Write with AI".

interface Body {
  imagePrompt: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.imagePrompt?.trim()) {
      return NextResponse.json({ error: "imagePrompt is required" }, { status: 400 });
    }
    const animationPrompt = await writeStoryAnimationPrompt({
      imagePrompt: body.imagePrompt,
    });
    return NextResponse.json({ animationPrompt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
