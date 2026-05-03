import { NextResponse } from "next/server";
import {
  createBufferUpdate,
  getBufferProfileMap,
  profileIdsForLanguage,
} from "@/lib/bufferServer";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  language: Language;
  videoUrl: string;
  caption: string;
  // Optional poster (the video's first-frame). Buffer uses this as the
  // pre-publish thumbnail in its UI; when omitted Buffer auto-extracts.
  thumbnailUrl?: string;
}

// Push a finished video into the user's Buffer drafts queue across the
// FB / IG / TikTok profiles mapped to the video's language. The user
// opens Buffer to schedule + publish. Returns per-profile success/error
// so the UI can show which channels actually queued.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.language || !body.videoUrl || !body.caption) {
      return NextResponse.json(
        { error: "language, videoUrl, caption are required" },
        { status: 400 },
      );
    }

    const map = getBufferProfileMap();
    const targets = profileIdsForLanguage(map, body.language);
    if (targets.length === 0) {
      return NextResponse.json(
        {
          error:
            `No Buffer profiles mapped for language "${body.language}". Set BUFFER_PROFILE_MAP_JSON in env.`,
        },
        { status: 400 },
      );
    }

    // One Buffer call covers all matched profiles for this language —
    // each profile gets its own queue entry on Buffer's side. Per-platform
    // failures are reported back via Buffer's response body.
    const { updateIds } = await createBufferUpdate({
      profileIds: targets.map((t) => t.profileId),
      text: body.caption,
      videoUrl: body.videoUrl,
      thumbnailUrl: body.thumbnailUrl,
    });

    return NextResponse.json({
      ok: true,
      queued: targets.map((t) => ({ platform: t.platform, profileId: t.profileId })),
      updateIds,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
