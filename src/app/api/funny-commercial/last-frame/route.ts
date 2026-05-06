import { NextResponse } from "next/server";
import { extractLastFrameViaWorker } from "@/lib/railwayClient";

export const runtime = "nodejs";
export const maxDuration = 90;

// POST /api/funny-commercial/last-frame
// Stand-alone last-frame extraction. Internally used by /shot/animate
// but also exposed so the panel can re-extract a frame if the original
// extraction failed silently.

interface Body {
  videoUrl: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.videoUrl) {
      return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
    }
    const frameUrl = await extractLastFrameViaWorker({ url: body.videoUrl });
    return NextResponse.json({ frameUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
