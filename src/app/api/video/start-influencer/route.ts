import { NextResponse } from "next/server";
import { generateInfluencerMiddleScript } from "@/lib/videoClaude";
import type { ContentType, Language } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  language: Language;
  contentType: ContentType;
  avatarName: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.language || !body.contentType || !body.avatarName) {
      return NextResponse.json(
        { error: "language, contentType, avatarName are required" },
        { status: 400 },
      );
    }

    const result = await generateInfluencerMiddleScript(
      body.language,
      body.contentType,
      body.avatarName,
    );
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
