import { NextResponse } from "next/server";
import { mirrorClipToR2 } from "@/lib/railwayClient";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  url: string;
  kind: "image" | "video";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.url || (body.kind !== "image" && body.kind !== "video")) {
      return NextResponse.json(
        { error: "url and kind ('image' | 'video') are required" },
        { status: 400 },
      );
    }
    const cachedUrl = await mirrorClipToR2({ url: body.url, kind: body.kind });
    return NextResponse.json({ cachedUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
