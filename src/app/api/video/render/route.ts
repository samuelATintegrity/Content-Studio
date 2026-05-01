import { NextResponse } from "next/server";
import { enqueueRender } from "@/lib/railwayClient";
import type { ContentType, Language } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  script: string;
  language: Language;
  contentType: ContentType;
  clipUrls: string[];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.script?.trim() || !body.language || !body.contentType) {
      return NextResponse.json(
        { error: "script, language, contentType are required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.clipUrls) || body.clipUrls.length === 0) {
      return NextResponse.json({ error: "clipUrls is required" }, { status: 400 });
    }
    const jobId = await enqueueRender({
      script: body.script,
      language: body.language,
      contentType: body.contentType,
      clipUrls: body.clipUrls,
    });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
