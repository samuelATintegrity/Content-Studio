import { NextResponse } from "next/server";
import { generateFcImage } from "@/lib/fal";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/funny-commercial/location
// Generate a reusable 9:16 backdrop image (apartment exterior, kitchen,
// hallway, etc.) via Nano Banana 2. The result is saved into the
// fcLocations library and used as an optional starter reference when
// composing shots — Nano then edits an actor or absurd subject INTO
// the location.

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
