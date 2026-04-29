"use client";

import { useEffect } from "react";
import { useBatchStore } from "@/store/batchStore";
import { getVideoStatus } from "@/lib/videoClient";

const POLL_INTERVAL_MS = 5000;

const TERMINAL = new Set(["ready", "failed"]);

// Per-card polling hook. Polls /api/video/status every 5s for the given
// post's jobId, writes results back into the store, and stops as soon as the
// job reaches a terminal state. Re-runs whenever jobId changes (e.g. regen).
export function useVideoPolling(postId: string): void {
  // Subscribe to the specific post so the effect re-runs only when it changes.
  const post = useBatchStore((s) => s.videoPosts.find((v) => v.id === postId));
  const update = useBatchStore((s) => s.updateVideoPost);

  const jobId = post?.jobId ?? null;
  const state = post?.state ?? "queued";

  useEffect(() => {
    if (!jobId) return;
    if (TERMINAL.has(state)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const status = await getVideoStatus(jobId);
        if (cancelled) return;
        update(postId, {
          state: status.state,
          progress: status.progress,
          ...(status.videoUrl !== undefined ? { videoUrl: status.videoUrl } : {}),
          ...(status.durationS !== undefined ? { durationS: status.durationS } : {}),
          ...(status.error !== undefined ? { error: status.error } : {}),
        });
        if (TERMINAL.has(status.state)) return;
      } catch (e) {
        if (cancelled) return;
        // Keep polling on transient errors; surface only after several misses
        // would be nicer, but a single error message is fine for now.
        update(postId, { error: e instanceof Error ? e.message : "polling failed" });
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, state, postId, update]);
}
