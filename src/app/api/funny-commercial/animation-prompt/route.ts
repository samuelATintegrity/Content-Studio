import { NextResponse } from "next/server";
import { writeFcAnimationPrompt } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/funny-commercial/animation-prompt
// Ask Claude (Haiku) to write a Veo-tuned image-to-video direction for
// the given still. Called by the panel right after the user accepts a
// composed shot still — pre-fills the animation-prompt textarea.

interface Body {
  imagePrompt: string;
  kind: "actor" | "crazy";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.imagePrompt?.trim()) {
      return NextResponse.json({ error: "imagePrompt is required" }, { status: 400 });
    }
    if (body.kind !== "actor" && body.kind !== "crazy") {
      return NextResponse.json({ error: "kind must be 'actor' or 'crazy'" }, { status: 400 });
    }
    const animationPrompt = await writeFcAnimationPrompt({
      imagePrompt: body.imagePrompt,
      kind: body.kind,
    });
    return NextResponse.json({ animationPrompt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
