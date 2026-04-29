import { NextResponse } from "next/server";
import { generateVideoScripts } from "@/lib/videoClaude";
import type { ContentType, Language, VideoStartResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface StartBody {
  language: Language;
  contentType: ContentType;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StartBody;
    if (!body.language || !body.contentType) {
      return NextResponse.json({ error: "language and contentType are required" }, { status: 400 });
    }

    const scripts = await generateVideoScripts(body.language, body.contentType);
    if (scripts.length === 0) {
      return NextResponse.json({ error: "Claude returned no scripts" }, { status: 502 });
    }

    return NextResponse.json({ scripts } satisfies VideoStartResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
