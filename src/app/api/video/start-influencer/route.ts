import { NextResponse } from "next/server";
import { generateInfluencerMiddleScripts } from "@/lib/videoClaude";
import type { ContentType, Language, MessageTheme } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  language: Language;
  contentType: ContentType;
  avatarName: string;
  // Optional for backward compat with any in-flight clients; defaults to
  // agent_match server-side.
  messageTheme?: MessageTheme;
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

    const scripts = await generateInfluencerMiddleScripts(
      body.language,
      body.contentType,
      body.avatarName,
      body.messageTheme ?? "agent_match",
    );
    if (scripts.length === 0) {
      return NextResponse.json({ error: "Claude returned no scripts" }, { status: 502 });
    }
    return NextResponse.json({ scripts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
