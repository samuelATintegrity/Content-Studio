import { NextResponse } from "next/server";
import { generateVideoScripts } from "@/lib/videoClaude";
import { enqueueRender } from "@/lib/railwayClient";
import type { Language, MessageTheme } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RegenBody {
  language: Language;
  messageTheme: MessageTheme;
  angleKey: string;
  clipUrls: string[];
  // Avatar voice override forwarded to the worker (today: Sarah for the
  // narration endorser style). Worker falls back to the language-default
  // env var when undefined.
  voiceId?: string;
}

// Regenerate a single card: same image set, fresh Claude script, fresh
// Railway render. The new render reuses the existing 5 clip URLs so we
// don't re-pay for image generation + animation.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegenBody;
    if (!body.language || !body.messageTheme || !body.angleKey) {
      return NextResponse.json(
        { error: "language, messageTheme, angleKey are required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.clipUrls) || body.clipUrls.length === 0) {
      return NextResponse.json({ error: "clipUrls is required" }, { status: 400 });
    }

    const scripts = await generateVideoScripts(body.language, body.messageTheme, [body.angleKey]);
    const next = scripts[0];
    if (!next) {
      return NextResponse.json({ error: "Claude returned no script for that angle" }, { status: 502 });
    }

    // Caption framing follows the theme — same mapping the script generator
    // uses internally — so the IG body matches the script's topic.
    const captionContentType =
      body.messageTheme === "dpa" ? "edu_dpa_local" : "good_agents";

    const jobId = await enqueueRender({
      script: next.script,
      language: body.language,
      contentType: captionContentType,
      clipUrls: body.clipUrls,
      voiceId: body.voiceId,
    });

    return NextResponse.json({
      angle: next.angle,
      script: next.script,
      caption: next.caption,
      jobId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
