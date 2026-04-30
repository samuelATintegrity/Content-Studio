"use client";

import { useBatchStore } from "@/store/batchStore";
import {
  animateSourceImage,
  generateSourceImage,
  mirrorClip,
  regenVideo,
  startVideoBatch,
  startVideoRender,
  type AnimationModel,
} from "@/lib/videoClient";
import { VIDEO_PROMPT_COUNT } from "@/lib/videoPrompts";

// Slot-specific animation model. Seedance is sharper and supports 1080p,
// but its safety filter rejects face-forward people shots. Kling is more
// permissive with faces, so we route the agent slot through it.
function modelForSlot(promptIndex: VideoSourcePromptIndex): AnimationModel {
  return promptIndex === 4 ? "kling" : "seedance";
}
import { saveSet, type SavedSet, type SavedSetSlot } from "@/lib/savedSets";
import { addLibraryClip } from "@/lib/clipLibrary";
import type {
  ImageSlot,
  VideoPost,
  VideoSourcePromptIndex,
} from "@/lib/types";

// Best-effort: mirror an animated clip (and its source image, when present)
// to R2 and add it to the flat clip library. Failures are swallowed — the
// live batch must never be blocked on archival.
async function archiveAnimatedClip(input: {
  videoUrl: string;
  imageUrl?: string;
  promptIndex: VideoSourcePromptIndex;
  batchId: string;
}): Promise<void> {
  try {
    const [videoMirror, imageMirror] = await Promise.all([
      mirrorClip({ url: input.videoUrl, kind: "video" }),
      input.imageUrl
        ? mirrorClip({ url: input.imageUrl, kind: "image" })
            .then((r) => r.cachedUrl)
            .catch(() => undefined)
        : Promise.resolve<string | undefined>(undefined),
    ]);
    addLibraryClip({
      url: videoMirror.cachedUrl,
      posterUrl: imageMirror,
      kind: "auto",
      sourcePromptIndex: input.promptIndex,
      batchId: input.batchId,
    });
  } catch {
    /* swallow */
  }
}

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
    const { url } = await animateSourceImage(slot.imageUrl, modelForSlot(promptIndex));
    const p = _pending;
    if (!p || p.batchId !== batchId) return;
    p.videoUrls.set(promptIndex, url);
    updateImageSlot(promptIndex, { state: "video_ready", videoUrl: url });
    void archiveAnimatedClip({ videoUrl: url, imageUrl: slot.imageUrl, promptIndex, batchId });
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
    const { url } = await animateSourceImage(slot.imageUrl, modelForSlot(promptIndex));
    const p = _pending;
    if (!p || p.batchId !== batchId) return;
    p.videoUrls.set(promptIndex, url);
    updateImageSlot(promptIndex, { state: "video_ready", videoUrl: url });
    void archiveAnimatedClip({ videoUrl: url, imageUrl: slot.imageUrl, promptIndex, batchId });
    maybeDispatchRenders(batchId);
  } catch (e) {
    updateImageSlot(promptIndex, {
      state: "failed",
      error: e instanceof Error ? e.message : "animation failed",
    });
  }
}

// Render queues — one per active batch. Renders fire serially: only one
// post is in flight at a time, the next is dispatched when the current
// reaches a terminal state. This avoids two ffmpeg processes competing
// on the same Railway worker.
interface RenderQueueEntry {
  postId: string;
  script: string;
  dispatched: boolean;
}
interface RenderQueue {
  batchId: string;
  language: ReturnType<typeof useBatchStore.getState>["language"];
  contentType: ReturnType<typeof useBatchStore.getState>["contentType"];
  clipUrls: string[];
  entries: RenderQueueEntry[];
}
const _renderQueues = new Map<string, RenderQueue>();

function dispatchEntry(queue: RenderQueue, entry: RenderQueueEntry): void {
  entry.dispatched = true;
  startVideoRender({
    script: entry.script,
    language: queue.language,
    contentType: queue.contentType,
    clipUrls: queue.clipUrls,
  })
    .then(({ jobId }) => {
      useBatchStore.getState().updateVideoPost(entry.postId, {
        jobId,
        state: "queued",
        progress: 0,
      });
    })
    .catch((e) => {
      useBatchStore.getState().updateVideoPost(entry.postId, {
        state: "failed",
        error: e instanceof Error ? e.message : "render dispatch failed",
      });
      // Even on dispatch failure, advance the queue so the next render
      // gets a shot rather than stalling everything behind a bad sibling.
      advanceRenderQueue(entry.postId);
    });
}

// Called from the polling layer when a post hits a terminal state. Finds
// the queue this post belongs to and dispatches the next undispatched
// entry, if any. Cleans up the queue once the last entry is in flight.
export function advanceRenderQueue(completedPostId: string): void {
  for (const queue of _renderQueues.values()) {
    const idx = queue.entries.findIndex((e) => e.postId === completedPostId);
    if (idx < 0) continue;
    const next = queue.entries.find((e) => !e.dispatched);
    if (next) {
      dispatchEntry(queue, next);
    } else if (queue.entries.every((e) => e.dispatched)) {
      _renderQueues.delete(queue.batchId);
    }
    return;
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

  // Build the queue and dispatch only the first entry. The rest fire as
  // each in-flight render reaches a terminal state — see advanceRenderQueue.
  const queue: RenderQueue = {
    batchId,
    language: p.language,
    contentType: p.contentType,
    clipUrls,
    entries: initial.map((post) => ({
      postId: post.id,
      script: post.script,
      dispatched: false,
    })),
  };
  // Drop any queues from prior batches so they can't dispatch ghost renders
  // if their posts somehow tick over after the user starts a new batch.
  _renderQueues.clear();
  _renderQueues.set(batchId, queue);
  if (queue.entries.length > 0) {
    dispatchEntry(queue, queue.entries[0]);
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

// User picked their own 5 clips from the library (or uploaded). Skip image +
// animation entirely; selection-order maps 1:1 to scene-order. Scripts are
// auto-generated like the from-scratch path.
export async function renderWithPickedClips(clipUrls: string[]): Promise<void> {
  if (clipUrls.length !== VIDEO_PROMPT_COUNT) {
    throw new Error(`Need ${VIDEO_PROMPT_COUNT} clips, got ${clipUrls.length}`);
  }

  const store = useBatchStore.getState();
  const { language, contentType, setLoading, setError, setVideoPosts, setImageSlots, clearClipSelection } = store;

  setLoading(true);
  setError(null);
  setVideoPosts([]);

  const slots: ImageSlot[] = clipUrls.map((url, i) => ({
    promptIndex: i as VideoSourcePromptIndex,
    state: "video_ready" as const,
    videoUrl: url,
  }));
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
  for (let i = 0; i < clipUrls.length; i++) {
    _pending.videoUrls.set(i as VideoSourcePromptIndex, clipUrls[i]);
  }

  clearClipSelection();

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
