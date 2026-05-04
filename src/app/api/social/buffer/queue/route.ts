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
  // Exactly one of videoUrl / imageUrl. Video → goes out as a reel on
  // FB/IG and a regular post on TikTok. Image → goes out as a feed
  // post; TikTok is skipped (Buffer's API rejects still images there).
  videoUrl?: string;
  imageUrl?: string;
  caption: string;
  thumbnailUrl?: string;
  platforms?: SocialPlatform[];
  // Buffer GraphQL public API only exposes "queue" (addToQueue) and
  // "scheduled" (customScheduled). The legacy v1 "now" and "draft"
  // modes were dropped after the migration.
  scheduleMode?: BufferScheduleMode;
  // Required when scheduleMode === "scheduled". Unix seconds (UTC).
  scheduledAtSec?: number;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.language || !body.caption) {
      return NextResponse.json(
        { error: "language, caption are required" },
        { status: 400 },
      );
    }
    if (!body.videoUrl && !body.imageUrl) {
      return NextResponse.json(
        { error: "videoUrl or imageUrl is required" },
        { status: 400 },
      );
    }
    if (body.videoUrl && body.imageUrl) {
      return NextResponse.json(
        { error: "pass exactly one of videoUrl / imageUrl" },
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
            `No matching Buffer channels for language "${body.language}". Set BUFFER_PROFILE_MAP_JSON or pick a different channel.`,
        },
        { status: 400 },
      );
    }

    let scheduledAtIso: string | undefined;
    if (body.scheduleMode === "scheduled") {
      if (!body.scheduledAtSec || !Number.isFinite(body.scheduledAtSec)) {
        return NextResponse.json(
          { error: "scheduledAtSec is required when scheduleMode === 'scheduled'" },
          { status: 400 },
        );
      }
      if (body.scheduledAtSec * 1000 < Date.now() - 60_000) {
        return NextResponse.json(
          { error: "scheduledAtSec is in the past — pick a future time." },
          { status: 400 },
        );
      }
      scheduledAtIso = new Date(body.scheduledAtSec * 1000).toISOString();
    }

    const { updateIds, errors } = await createBufferUpdate({
      targets: targets.map((t) => ({ profileId: t.profileId, platform: t.platform })),
      text: body.caption,
      videoUrl: body.videoUrl,
      imageUrl: body.imageUrl,
      thumbnailUrl: body.thumbnailUrl,
      scheduleMode: body.scheduleMode ?? "queue",
      scheduledAtIso,
    });

    // Map any per-channel failures back to platform names so the UI can
    // tell the user "TikTok failed" rather than echoing channel UUIDs.
    const failedByProfileId = new Map(errors.map((e) => [e.profileId, e.message]));
    const queued = targets
      .filter((t) => !failedByProfileId.has(t.profileId))
      .map((t) => ({ platform: t.platform, profileId: t.profileId }));
    const failed = targets
      .filter((t) => failedByProfileId.has(t.profileId))
      .map((t) => ({
        platform: t.platform,
        profileId: t.profileId,
        message: failedByProfileId.get(t.profileId) ?? "unknown",
      }));

    return NextResponse.json({
      ok: true,
      queued,
      failed,
      updateIds,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
