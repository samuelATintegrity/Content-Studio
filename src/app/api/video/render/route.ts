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
  // Funny Commercial v2 — variable-length timeline of pre-animated
  // shots. clipUrls is empty for this mode (the worker pulls per-slot
  // clips from fcTimeline). The worker also handles per-slot narration
  // TTS inline via ElevenLabs.
  fcTimeline?: Array<{
    clipUrl: string;
    durationS?: number;
    overlay?: { text: string; narrate: boolean; voiceId?: string };
  }>;
  fcLogoOutroDurationS?: number;
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
    if (!isFc && (!Array.isArray(body.clipUrls) || body.clipUrls.length === 0)) {
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
      if (!Array.isArray(body.fcTimeline) || body.fcTimeline.length === 0) {
        return NextResponse.json(
          { error: "fcTimeline (non-empty array) is required for funny_commercial mode" },
          { status: 400 },
        );
      }
      for (const slot of body.fcTimeline) {
        if (!slot.clipUrl) {
          return NextResponse.json(
            { error: "every fcTimeline slot needs a clipUrl" },
            { status: 400 },
          );
        }
      }
    }
    const jobId = await enqueueRender({
      script: body.script ?? "",
      language: body.language,
      contentType: body.contentType,
      // Worker still wants a clipUrls array on its base shape; for
      // funny_commercial we pass the timeline urls so the validator
      // upstream sees a non-empty array, but the worker reads the
      // canonical list from fcTimeline.
      clipUrls: isFc
        ? (body.fcTimeline ?? []).map((s) => s.clipUrl)
        : body.clipUrls,
      mode: body.mode,
      voiceId: body.voiceId,
      introClipUrl: body.introClipUrl,
      introCaptionCutoffPhrase: body.introCaptionCutoffPhrase,
      outroClipUrl: body.outroClipUrl,
      outroCaptionCutoffPhrase: body.outroCaptionCutoffPhrase,
      musicShuffleIndex: body.musicShuffleIndex,
      fcTimeline: body.fcTimeline,
      fcLogoOutroDurationS: body.fcLogoOutroDurationS,
      fcMusicTrackUrl: body.fcMusicTrackUrl,
    });
    return NextResponse.json({ jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
