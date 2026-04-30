import { NextResponse } from "next/server";
import { tagClipViaWorker } from "@/lib/railwayClient";

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_TRANSFORM_HEADERS = {
  "cache-control": "no-store, no-transform",
  "content-encoding": "identity",
};

interface Body {
  url: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.url) {
      return NextResponse.json(
        { error: "url is required" },
        { status: 400, headers: NO_TRANSFORM_HEADERS },
      );
    }
    const tags = await tagClipViaWorker({ url: body.url });
    return NextResponse.json({ tags }, { headers: NO_TRANSFORM_HEADERS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: NO_TRANSFORM_HEADERS },
    );
  }
}
