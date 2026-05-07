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
  // Influencer-mode fields. Optional — narration-mode renders omit these.
  mode?: "narration" | "influencer";
  voiceId?: string;
  introClipUrl?: string;
  introCaptionCutoffPhrase?: string;
  outroClipUrl?: string;
  outroCaptionCutoffPhrase?: string;
  // Per-render deterministic music selection (worker picks
  // music[abs(idx) % count]). App sets it across a batch so the 3
  // influencer renders pick 3 distinct music files.
  musicShuffleIndex?: number;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.language || !body.contentType) {
      return NextResponse.json(
        { error: "language, contentType are required" },
        { status: 400 },
      );
    }
    if (!body.script?.trim()) {
      return NextResponse.json(
        { error: "script is required" },
        { status: 400 },
      );
    }
    if (!Array.isArray(body.clipUrls) || body.clipUrls.length === 0) {
      return NextResponse.json({ error: "clipUrls is required" }, { status: 400 });
    }
    if (body.mode === "influencer") {
      if (!body.introClipUrl || !body.outroClipUrl) {
        return NextResponse.json(
          { error: "introClipUrl and outroClipUrl are required for influencer mode" },
          { status: 400 },
        );
      }
      if (!body.voiceId) {
        return NextResponse.json(
          { error: "voiceId is required for influencer mode" },
          { status: 400 },
        );
      }
    }
    const jobId = await enqueueRender({
      script: body.script,
      language: body.language,
      contentType: body.contentType,
      clipUrls: body.clipUrls,
      mode: body.mode,
      voiceId: body.voiceId,
      introClipUrl: body.introClipUrl,
      introCaptionCutoffPhrase: body.introCaptionCutoffPhrase,
      outroClipUrl: body.outroClipUrl,
      outroCaptionCutoffPhrase: body.outroCaptionCutoffPhrase,
      musicShuffleIndex: body.musicShuffleIndex,
    });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
