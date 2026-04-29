"use client";

import { useBatchStore } from "@/store/batchStore";
import { regenVideo, startVideoBatch } from "@/lib/videoClient";
import type { VideoPost } from "@/lib/types";

// Kick off a fresh video batch: ask Claude for 3 scripts, enqueue 3 Railway
// renders, seed the store with placeholder VideoPosts. The per-card
// useVideoPolling hook handles status polling once the cards mount.
export async function generateVideoBatch(): Promise<void> {
  const { language, contentType, setLoading, setError, setVideoPosts } = useBatchStore.getState();

  setLoading(true);
  setError(null);
  setVideoPosts([]);

  try {
    const res = await startVideoBatch(language, contentType);
    const initial: VideoPost[] = res.jobs.map((j, i) => ({
      id: `${Date.now()}-${i}`,
      angle: j.angle,
      script: j.script,
      caption: j.caption,
      jobId: j.jobId,
      state: "queued",
      progress: 0,
    }));
    setVideoPosts(initial);
  } catch (e) {
    setError(e instanceof Error ? e.message : "unknown error");
  } finally {
    setLoading(false);
  }
}

// Regenerate one card: fresh Claude script for the same angle, fresh Railway
// render. The card's useVideoPolling effect picks up the new jobId.
export async function regenerateOneVideo(postId: string): Promise<void> {
  const state = useBatchStore.getState();
  const post = state.videoPosts.find((v) => v.id === postId);
  if (!post) return;

  state.updateVideoPost(postId, { state: "queued", progress: 0, error: undefined, videoUrl: undefined });

  try {
    const fresh = await regenVideo(state.language, state.contentType, post.angle);
    state.updateVideoPost(postId, {
      script: fresh.script,
      caption: fresh.caption,
      jobId: fresh.jobId,
      state: "queued",
      progress: 0,
      videoUrl: undefined,
      error: undefined,
    });
  } catch (e) {
    state.updateVideoPost(postId, {
      state: "failed",
      error: e instanceof Error ? e.message : "regen failed",
    });
  }
}
