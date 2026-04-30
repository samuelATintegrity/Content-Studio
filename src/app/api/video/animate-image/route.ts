import { NextResponse } from "next/server";
import { animateImage, type AnimationModel } from "@/lib/fal";

export const runtime = "nodejs";
// Both Seedance 2.0 and Kling v3 Pro typically return in 60-120s. Hold the
// request open up to 5 min to be safe; fal.subscribe waits via polling.
export const maxDuration = 300;

interface Body {
  imageUrl: string;
  model?: AnimationModel;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.imageUrl) {
      return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
    }
    const model: AnimationModel = body.model === "kling" ? "kling" : "seedance";
    const { url } = await animateImage(body.imageUrl, model);
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
