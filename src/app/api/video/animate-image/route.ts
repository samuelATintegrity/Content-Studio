import { NextResponse } from "next/server";
import { animateImage } from "@/lib/fal";

export const runtime = "nodejs";
// Seedance 2.0 image-to-video typically returns in 60-90s. Hold the request
// open up to 5 min to be safe; fal.subscribe waits via polling internally.
export const maxDuration = 300;

interface Body {
  imageUrl: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.imageUrl) {
      return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
    }
    const { url } = await animateImage(body.imageUrl);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
