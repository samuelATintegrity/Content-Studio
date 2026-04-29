import { NextResponse } from "next/server";
import { generateVideoScripts } from "@/lib/videoClaude";
import { enqueueRender } from "@/lib/railwayClient";
import type { ContentType, Language } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RegenBody {
  language: Language;
  contentType: ContentType;
  angleKey: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegenBody;
    if (!body.language || !body.contentType || !body.angleKey) {
      return NextResponse.json(
        { error: "language, contentType, angleKey are required" },
        { status: 400 },
      );
    }

    const scripts = await generateVideoScripts(body.language, body.contentType, [body.angleKey]);
    const next = scripts[0];
    if (!next) {
      return NextResponse.json({ error: "Claude returned no script for that angle" }, { status: 502 });
    }

    const jobId = await enqueueRender({
      script: next.script,
      language: body.language,
      contentType: body.contentType,
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
