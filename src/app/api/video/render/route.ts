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
  mode?: "narration" | "influencer" | "funny_commercial";
  voiceId?: string;
  introClipUrl?: string;
  introCaptionCutoffPhrase?: string;
  outroClipUrl?: string;
  outroCaptionCutoffPhrase?: string;
  // Per-render deterministic music selection (worker picks
  // music[abs(idx) % count]). App sets it across a batch so the 3
  // influencer renders pick 3 distinct music files.
  musicShuffleIndex?: number;
  // Funny Commercial fields. Only meaningful when mode === "funny_commercial".
  // clipUrls in that mode is [scene1Url, scene2ActorUrl] in scene order;
  // the worker bakes Scene 3 (black + CTA) and Scene 4 (logo).
  fcScene2Text?: string;
  fcScene3Text?: string;
  fcScene1DurationS?: number;
  fcScene2DurationS?: number;
  fcScene3DurationS?: number;
  fcScene4DurationS?: number;
  fcMusicTrackUrl?: string | null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const isFc = body.mode === "funny_commercial";
    if (!body.language || !body.contentType) {
      return NextResponse.json(
        { error: "language, contentType are required" },
        { status: 400 },
      );
    }
    if (!isFc && !body.script?.trim()) {
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
    if (isFc) {
      if (body.clipUrls.length !== 2) {
        return NextResponse.json(
          { error: "funny_commercial requires exactly 2 clipUrls (scene1, scene2)" },
          { status: 400 },
        );
      }
      if (!body.fcScene2Text?.trim() || !body.fcScene3Text?.trim()) {
        return NextResponse.json(
          { error: "fcScene2Text and fcScene3Text are required for funny_commercial mode" },
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
      fcScene2Text: body.fcScene2Text,
      fcScene3Text: body.fcScene3Text,
      fcScene1DurationS: body.fcScene1DurationS,
      fcScene2DurationS: body.fcScene2DurationS,
      fcScene3DurationS: body.fcScene3DurationS,
      fcScene4DurationS: body.fcScene4DurationS,
      fcMusicTrackUrl: body.fcMusicTrackUrl,
    });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
