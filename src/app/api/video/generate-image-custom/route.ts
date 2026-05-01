import { NextResponse } from "next/server";
import { generateCustomVideoImage } from "@/lib/fal";

export const runtime = "nodejs";
export const maxDuration = 90;

interface Body {
  prompt: string;
}

// Manual AI clip flow (library picker): user types a prompt, we run
// Nano Banana 2 with the same 9:16 style suffix the slot generator uses
// so the result blends visually with the rest of the library.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    if (prompt.length > 1000) {
      return NextResponse.json({ error: "prompt too long (max 1000 chars)" }, { status: 400 });
    }
    const { url } = await generateCustomVideoImage(prompt);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
