import { NextResponse } from "next/server";
import {
  createBufferUpdate,
  getBufferProfileMap,
  profileIdsForLanguage,
  type BufferScheduleMode,
  type SocialPlatform,
} from "@/lib/bufferServer";
import type { Language } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  language: Language;
  videoUrl: string;
  caption: string;
  thumbnailUrl?: string;
  // Subset of platforms to send to. Defaults to every platform mapped
  // for the language. Used by the send modal's per-channel checkboxes.
  platforms?: SocialPlatform[];
  // Schedule semantics. "draft" (default) leaves the post in the user's
  // Buffer drafts so they finish scheduling there; "now" / "queue" /
  // "scheduled" let Content Studio be the only surface they touch.
  scheduleMode?: BufferScheduleMode;
  // Required when scheduleMode === "scheduled". Unix seconds (UTC).
  scheduledAtSec?: number;
}

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
    let targets = profileIdsForLanguage(map, body.language);
    if (body.platforms && body.platforms.length > 0) {
      const allowed = new Set(body.platforms);
      targets = targets.filter((t) => allowed.has(t.platform));
    }
    if (targets.length === 0) {
      return NextResponse.json(
        {
          error:
            `No matching Buffer profiles for language "${body.language}". Set BUFFER_PROFILE_MAP_JSON or pick a different channel.`,
        },
        { status: 400 },
      );
    }

    if (body.scheduleMode === "scheduled") {
      if (!body.scheduledAtSec || !Number.isFinite(body.scheduledAtSec)) {
        return NextResponse.json(
          { error: "scheduledAtSec is required when scheduleMode === 'scheduled'" },
          { status: 400 },
        );
      }
      // Reject past timestamps so users don't accidentally fire posts
      // they thought were future-dated.
      if (body.scheduledAtSec * 1000 < Date.now() - 60_000) {
        return NextResponse.json(
          { error: "scheduledAtSec is in the past — pick a future time." },
          { status: 400 },
        );
      }
    }

    const { updateIds } = await createBufferUpdate({
      profileIds: targets.map((t) => t.profileId),
      text: body.caption,
      videoUrl: body.videoUrl,
      thumbnailUrl: body.thumbnailUrl,
      scheduleMode: body.scheduleMode ?? "draft",
      scheduledAtSec: body.scheduledAtSec,
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
