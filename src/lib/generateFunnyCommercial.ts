"use client";

// Funny Commercial v2 — batch dispatch.
//
// Walks the per-batch timeline in batchStore, hydrates each slot with
// its referenced shot's videoUrl, and POSTs the timeline payload to
// /api/video/render. Worker handles TTS narration inline. Result is a
// VideoPost rendered by the existing VideoCard machinery.

import { useBatchStore } from "@/store/batchStore";
import { listFcShots } from "@/lib/funnyCommercialShots";
import { startFunnyCommercialRender } from "@/lib/videoClient";
import type { VideoPost } from "@/lib/types";

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export async function generateFunnyCommercialBatch(): Promise<void> {
  const state = useBatchStore.getState();
  const {
    language,
    fcTimelineItems,
    setLoading,
    setError,
    setVideoPosts,
    updateVideoPost,
  } = state;

  if (fcTimelineItems.length === 0) {
    setError("Add at least one shot to the timeline first.");
    return;
  }

  // Resolve every slot's shot — fail fast if any reference is dead.
  const allShots = listFcShots();
  const resolved = fcTimelineItems.map((item) => {
    const shot = allShots.find((s) => s.id === item.shotId);
    return { item, shot };
  });
  const missing = resolved.filter((r) => !r.shot || !r.shot.videoUrl);
  if (missing.length > 0) {
    setError(
      `${missing.length} timeline slot${missing.length === 1 ? "" : "s"} reference a shot that hasn't been animated yet.`,
    );
    return;
  }

  setError(null);
  setLoading(true);

  // Single-clip "batch" — one ad per click. Mirrors the
  // narration/influencer flows so the existing VideoCard + polling
  // pick it up unchanged.
  const id = newId("fc");
  const initial: VideoPost = {
    id,
    angle: "funny_commercial",
    script: "",
    caption: "",
    jobId: null,
    state: "queued",
    progress: 0.05,
    mode: "narration",                 // legacy union — VideoCard uses this only for label rendering
    language,
  };
  setVideoPosts([initial]);

  try {
    const timeline = resolved.map(({ item, shot }) => ({
      clipUrl: shot!.videoUrl!,
      durationS: item.durationS,
      overlay: item.overlay
        ? {
            text: item.overlay.text,
            narrate: item.overlay.narrate,
            voiceId: item.overlay.voiceId,
          }
        : undefined,
    }));

    const { jobId } = await startFunnyCommercialRender({
      language,
      timeline,
    });
    updateVideoPost(id, { jobId, state: "queued", progress: 0.1 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Funny Commercial render failed";
    setError(msg);
    updateVideoPost(id, { state: "failed", error: msg });
  } finally {
    setLoading(false);
  }
}
