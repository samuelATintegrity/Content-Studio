import { NextResponse } from "next/server";
import { generateVideoSourceImage } from "@/lib/fal";
import type { VideoSourcePromptIndex } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

interface Body {
  promptIndex: number;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const idx = body.promptIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx > 4) {
      return NextResponse.json({ error: "promptIndex must be 0..4" }, { status: 400 });
    }
    const { url } = await generateVideoSourceImage(idx as VideoSourcePromptIndex);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
