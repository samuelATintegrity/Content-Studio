"use client";

import { useBatchStore } from "@/store/batchStore";
import {
  animateSourceImage,
  generateSourceImage,
  mirrorClip,
  regenVideo,
  startVideoBatch,
  startVideoRender,
} from "@/lib/videoClient";
import { VIDEO_PROMPT_COUNT } from "@/lib/videoPrompts";
import { saveSet, type SavedSet, type SavedSetSlot } from "@/lib/savedSets";
import type {
  ImageSlot,
  VideoPost,
  VideoSourcePromptIndex,
} from "@/lib/types";

// Hold the in-flight scripts so the approve callback can dispatch the 3
// renders once all 5 clips are ready, without round-tripping through the
// store. Keyed by a synthetic batchId we mint on each kickoff.
interface PendingBatch {
  batchId: string;
  scripts: Array<{ angle: string; script: string; caption: string }>;
  language: ReturnType<typeof useBatchStore.getState>["language"];
  contentType: ReturnType<typeof useBatchStore.getState>["contentType"];
  // Set of slot indexes already animated. Render dispatches when size === 5.
  videoUrls: Map<VideoSourcePromptIndex, string>;
  scriptsResolved: boolean;
  rendersDispatched: boolean;
}

let _pending: PendingBatch | null = null;

function emptySlots(): ImageSlot[] {
  return Array.from({ length: VIDEO_PROMPT_COUNT }, (_, i) => ({
    promptIndex: i as VideoSourcePromptIndex,
    state: "queued" as const,
  }));
}

// Kick off a new batch:
//   1. Reset slot + video state, fire script generation in parallel.
//   2. Sequentially generate images 0..4. Each one ends in awaiting_approval
//      and waits for the user. (See approveImage / rejectImage below.)
export async function generateVideoBatch(): Promise<void> {
  const store = useBatchStore.getState();
  const { language, contentType, setLoading, setError, setVideoPosts, setImageSlots } = store;

  setLoading(true);
  setError(null);
  setVideoPosts([]);
  setImageSlots(emptySlots());

  const batchId = `${Date.now()}`;
  _pending = {
    batchId,
    scripts: [],
    language,
    contentType,
    videoUrls: new Map(),
    scriptsResolved: false,
    rendersDispatched: false,
  };

  // Fire script generation in parallel with image gen. Both must resolve
  // before we can dispatch the 3 renders.
  const scriptsPromise = startVideoBatch(language, contentType)
    .then((res) => {
      const p = _pending;
      if (!p || p.batchId !== batchId) return;
      p.scripts = res.scripts;
      p.scriptsResolved = true;
      maybeDispatchRenders(batchId);
    })
    .catch((e) => {
      setError(e instanceof Error ? e.message : "scripts failed");
      _pending = null;
    });

  try {
    // Image generation must be sequential: fal.ai breaks under concurrency.
    for (let i = 0; i < VIDEO_PROMPT_COUNT; i++) {
      const idx = i as VideoSourcePromptIndex;
      // If a previous image was rejected and the user clicked regenerate,
      // the slot may already be back in `generating` for that index — but
      // in this initial loop the slot is still `queued`, so we just go.
      await generateImageForSlot(idx, batchId);
      // Loop pauses here implicitly: generateImageForSlot only resolves
      // once the image has been generated and set to awaiting_approval.
      // The next iteration starts the NEXT slot — note this means slot
      // i+1 begins generating while the user is still approving slot i,
      // which is a deliberate tradeoff: avoids serial wall-time blockage.
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : "image generation failed");
  } finally {
    setLoading(false);
  }

  // Don't await scriptsPromise here — the FAB stops spinning once images
  // start showing up. Errors are surfaced via setError.
  void scriptsPromise;
}

async function generateImageForSlot(
  promptIndex: VideoSourcePromptIndex,
  batchId: string,
): Promise<void> {
  const { updateImageSlot } = useBatchStore.getState();
  updateImageSlot(promptIndex, { state: "generating", error: undefined });
  try {
    const { url } = await generateSourceImage(promptIndex);
    if (!_pending || _pending.batchId !== batchId) return; // batch was abandoned
    updateImageSlot(promptIndex, {
      state: "awaiting_approval",
      imageUrl: url,
      error: undefined,
    });
  } catch (e) {
    updateImageSlot(promptIndex, {
      state: "failed",
      error: e instanceof Error ? e.message : "image generation failed",
    });
    throw e;
  }
}

// User pressed Approve on a slot. Kick off Seedance animation in the
// background; on completion, record the video URL and try to dispatch the
// 3 renders if everything is ready.
export async function approveImage(promptIndex: VideoSourcePromptIndex): Promise<void> {
  const { imageSlots, updateImageSlot } = useBatchStore.getState();
  const slot = imageSlots.find((s) => s.promptIndex === promptIndex);
  if (!slot || slot.state !== "awaiting_approval" || !slot.imageUrl) return;
  if (!_pending) return;

  const batchId = _pending.batchId;
  updateImageSlot(promptIndex, { state: "animating", error: undefined });

  try {
    const { url } = await animateSourceImage(slot.imageUrl);
    const p = _pending;
    if (!p || p.batchId !== batchId) return;
    p.videoUrls.set(promptIndex, url);
    updateImageSlot(promptIndex, { state: "video_ready", videoUrl: url });
    maybeDispatchRenders(batchId);
  } catch (e) {
    updateImageSlot(promptIndex, {
      state: "failed",
      error: e instanceof Error ? e.message : "animation failed",
    });
  }
}

// User pressed Reject. Re-roll the same prompt slot with a new seed.
export async function rejectImage(promptIndex: VideoSourcePromptIndex): Promise<void> {
  if (!_pending) return;
  const batchId = _pending.batchId;
  await generateImageForSlot(promptIndex, batchId).catch((e) => {
    useBatchStore.getState().setError(e instanceof Error ? e.message : "regenerate failed");
  });
}

// Re-attempt animation on a failed slot without regenerating the image.
export async function retryAnimation(promptIndex: VideoSourcePromptIndex): Promise<void> {
  const { imageSlots, updateImageSlot } = useBatchStore.getState();
  const slot = imageSlots.find((s) => s.promptIndex === promptIndex);
  if (!slot || !slot.imageUrl) return;
  if (!_pending) return;

  const batchId = _pending.batchId;
  updateImageSlot(promptIndex, { state: "animating", error: undefined });
  try {
    const { url } = await animateSourceImage(slot.imageUrl);
    const p = _pending;
    if (!p || p.batchId !== batchId) return;
    p.videoUrls.set(promptIndex, url);
    updateImageSlot(promptIndex, { state: "video_ready", videoUrl: url });
    maybeDispatchRenders(batchId);
  } catch (e) {
    updateImageSlot(promptIndex, {
      state: "failed",
      error: e instanceof Error ? e.message : "animation failed",
    });
  }
}

function maybeDispatchRenders(batchId: string): void {
  const p = _pending;
  if (!p || p.batchId !== batchId) return;
  if (p.rendersDispatched) return;
  if (!p.scriptsResolved) return;
  if (p.videoUrls.size < VIDEO_PROMPT_COUNT) return;

  p.rendersDispatched = true;

  // Build clipUrls in canonical prompt-index order.
  const clipUrls: string[] = [];
  for (let i = 0; i < VIDEO_PROMPT_COUNT; i++) {
    const url = p.videoUrls.get(i as VideoSourcePromptIndex);
    if (!url) {
      // Should be unreachable — size check above guarantees presence.
      return;
    }
    clipUrls.push(url);
  }

  const store = useBatchStore.getState();

  // Seed 3 video posts in waiting_images state, then kick off renders.
  const initial: VideoPost[] = p.scripts.map((s, i) => ({
    id: `${batchId}-${i}`,
    angle: s.angle,
    script: s.script,
    caption: s.caption,
    jobId: null,
    state: "waiting_images",
    progress: 0,
  }));
  store.setVideoPosts(initial);

  // Dispatch each render in parallel; on success, transition the post to
  // queued with its jobId so useVideoPolling takes over.
  for (const post of initial) {
    startVideoRender({
      script: post.script,
      language: p.language,
      contentType: p.contentType,
      clipUrls,
    })
      .then(({ jobId }) => {
        useBatchStore.getState().updateVideoPost(post.id, {
          jobId,
          state: "queued",
          progress: 0,
        });
      })
      .catch((e) => {
        useBatchStore.getState().updateVideoPost(post.id, {
          state: "failed",
          error: e instanceof Error ? e.message : "render dispatch failed",
        });
      });
  }
}

// Load a previously saved (R2-mirrored) image set: skip Nano Banana and
// Seedance entirely, reuse the cached URLs, and proceed straight to script
// + render dispatch. Costs only Claude + ElevenLabs + Railway compute.
export async function useSavedSet(set: SavedSet): Promise<void> {
  const store = useBatchStore.getState();
  const { language, contentType, setLoading, setError, setVideoPosts, setImageSlots } = store;

  setLoading(true);
  setError(null);
  setVideoPosts([]);

  // Seed the slots in video_ready state directly from the saved set.
  const slots: ImageSlot[] = Array.from({ length: VIDEO_PROMPT_COUNT }, (_, i) => {
    const cached = set.slots.find((s) => s.promptIndex === i);
    if (cached) {
      return {
        promptIndex: i as VideoSourcePromptIndex,
        state: "video_ready" as const,
        imageUrl: cached.imageUrl,
        videoUrl: cached.videoUrl,
      };
    }
    return { promptIndex: i as VideoSourcePromptIndex, state: "queued" as const };
  });
  setImageSlots(slots);

  const batchId = `${Date.now()}`;
  _pending = {
    batchId,
    scripts: [],
    language,
    contentType,
    videoUrls: new Map(),
    scriptsResolved: false,
    rendersDispatched: false,
  };
  // Pre-populate _pending.videoUrls so maybeDispatchRenders can fire as soon
  // as the scripts resolve.
  for (const slot of slots) {
    if (slot.state === "video_ready" && slot.videoUrl) {
      _pending.videoUrls.set(slot.promptIndex, slot.videoUrl);
    }
  }

  const scriptsPromise = startVideoBatch(language, contentType)
    .then((res) => {
      const p = _pending;
      if (!p || p.batchId !== batchId) return;
      p.scripts = res.scripts;
      p.scriptsResolved = true;
      maybeDispatchRenders(batchId);
    })
    .catch((e) => {
      setError(e instanceof Error ? e.message : "scripts failed");
      _pending = null;
    });

  setLoading(false);
  void scriptsPromise;
}

// Mirror the current (live) image set's image+video URLs to R2 and write
// the resulting stable URLs into localStorage as a named set.
export async function saveCurrentSet(name: string): Promise<SavedSet> {
  const slots = useBatchStore.getState().imageSlots;
  const ready = slots.filter((s) => s.state === "video_ready" && s.imageUrl && s.videoUrl);
  if (ready.length !== VIDEO_PROMPT_COUNT) {
    throw new Error(`Image set is incomplete (${ready.length} of ${VIDEO_PROMPT_COUNT} slots ready)`);
  }

  // Mirror in parallel — image and video for each slot. Each slot is a pair.
  const mirrored: SavedSetSlot[] = await Promise.all(
    ready.map(async (slot) => {
      const [{ cachedUrl: imageUrl }, { cachedUrl: videoUrl }] = await Promise.all([
        mirrorClip({ url: slot.imageUrl!, kind: "image" }),
        mirrorClip({ url: slot.videoUrl!, kind: "video" }),
      ]);
      return {
        promptIndex: slot.promptIndex,
        imageUrl,
        videoUrl,
      } satisfies SavedSetSlot;
    }),
  );

  return saveSet(name, mirrored);
}

// Per-card regeneration. Reuses the existing clipUrls from the live image
// set — only Claude + Railway re-run, no new fal.ai charges.
export async function regenerateOneVideo(postId: string): Promise<void> {
  const state = useBatchStore.getState();
  const post = state.videoPosts.find((v) => v.id === postId);
  if (!post) return;

  // Pull clipUrls from the current image set (in canonical order).
  const clipUrls: string[] = [];
  for (const slot of state.imageSlots) {
    if (!slot.videoUrl) {
      state.updateVideoPost(postId, {
        state: "failed",
        error: "Image set is incomplete; regenerate the batch first.",
      });
      return;
    }
    clipUrls.push(slot.videoUrl);
  }

  state.updateVideoPost(postId, {
    state: "queued",
    progress: 0,
    jobId: null,
    error: undefined,
    videoUrl: undefined,
  });

  try {
    const fresh = await regenVideo({
      language: state.language,
      contentType: state.contentType,
      angleKey: post.angle,
      clipUrls,
    });
    useBatchStore.getState().updateVideoPost(postId, {
      script: fresh.script,
      caption: fresh.caption,
      jobId: fresh.jobId,
      state: "queued",
      progress: 0,
      videoUrl: undefined,
      error: undefined,
    });
  } catch (e) {
    useBatchStore.getState().updateVideoPost(postId, {
      state: "failed",
      error: e instanceof Error ? e.message : "regen failed",
    });
  }
}
