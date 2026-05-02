"use client";

import { useBatchStore } from "@/store/batchStore";
import {
  animateSourceImage,
  generateSourceImage,
  mirrorClip,
  regenVideo,
  startInfluencerRender,
  startInfluencerScript,
  startVideoBatch,
  startVideoRender,
  type AnimationModel,
} from "@/lib/videoClient";
import {
  INFLUENCER_MIDDLE_COUNT,
  VIDEO_PROMPT_COUNT,
} from "@/lib/videoPrompts";
import { getAvatar } from "@/lib/avatars";

// Animation model for a given prompt category. Seedance is sharper and
// supports 1080p, but its safety filter rejects face-forward people shots.
// Kling is more permissive with faces, so we route the agent prompt
// (index 4) through it.
function modelForPromptIndex(aiPromptIndex: VideoSourcePromptIndex): AnimationModel {
  return aiPromptIndex === 4 ? "kling" : "seedance";
}
import { saveSet, type SavedSet, type SavedSetSlot } from "@/lib/savedSets";
import { addLibraryClip, listMergedLibrary, updateLibraryClip } from "@/lib/clipLibrary";
import { tagClip } from "@/lib/videoClient";
import { PICKED_CLIP_COUNT } from "@/lib/videoPrompts";
import type {
  ContentType,
  ImageSlot,
  MessageTheme,
  VideoPost,
  VideoSourcePromptIndex,
} from "@/lib/types";

// Narration mode now picks one of two messaging themes (agent_match,
// dpa) just like the influencer flow. The render route still wants a
// content-type field for caption framing — derive it from the theme.
function narrationContentTypeFor(theme: MessageTheme): ContentType {
  return theme === "dpa" ? "edu_dpa_local" : "good_agents";
}

// All narration renders run through Sarah's avatar voice now. Falls
// back to the language-default env var if the avatar is somehow missing.
function narrationVoiceId(): string | undefined {
  return getAvatar("Sarah")?.voiceId;
}

// Best-effort: mirror an animated clip (and its source image, when present)
// to R2 and add it to the flat clip library. Failures are swallowed — the
// live batch must never be blocked on archival.
async function archiveAnimatedClip(input: {
  videoUrl: string;
  imageUrl?: string;
  aiPromptIndex: VideoSourcePromptIndex;
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
    // Stamp the clip with the batch's language at generation time. The
    // user can override via the per-tile language pill if the visual
    // doesn't actually require that language.
    const language = useBatchStore.getState().language;
    const clip = addLibraryClip({
      url: videoMirror.cachedUrl,
      posterUrl: imageMirror,
      kind: "auto",
      sourcePromptIndex: input.aiPromptIndex,
      batchId: input.batchId,
      language,
    });
    // Fire-and-forget vision tag pass. Failures are silent — clip just
    // shows up untagged, which the picker UI handles fine.
    void tagClip(clip.url)
      .then((tags) => updateLibraryClip(clip.id, { tags }))
      .catch(() => undefined);
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
  // Narration mode batches stamp this on each VideoPost so per-card regen
  // re-rolls into the same theme. Undefined for static / influencer
  // dispatches that route through their own paths.
  messageTheme?: MessageTheme;
  // slotIndex → final animated/picked clip URL. Render dispatches when this
  // has an entry for every slot index in [0, slotCount).
  videoUrls: Map<number, string>;
  // Total slot count for this batch — 5 for from-scratch, 8 for picked /
  // mixed flows. Drives `maybeDispatchRenders`'s readiness check.
  slotCount: number;
  // Pure picked-clip flow short-circuit: when set, dispatch uses these URLs
  // as clipUrls directly (skipping the per-slot Map and the image set panel).
  pickedClipUrls?: string[];
  scriptsResolved: boolean;
  rendersDispatched: boolean;
}

let _pending: PendingBatch | null = null;

// Slots for the from-scratch flow: 5 AI slots, each with its own prompt.
function emptyFromScratchSlots(): ImageSlot[] {
  return Array.from({ length: VIDEO_PROMPT_COUNT }, (_, i) => ({
    promptIndex: i,
    source: "ai" as const,
    aiPromptIndex: i as VideoSourcePromptIndex,
    state: "queued" as const,
  }));
}

// Slots for the mixed flow: first N from the user's library picks
// (video_ready immediately), remaining (PICKED_CLIP_COUNT - N) AI fills
// that cycle through the 5-prompt pool starting from prompt 0.
function buildMixedSlots(pickedClipUrls: string[]): ImageSlot[] {
  const total = PICKED_CLIP_COUNT;
  const slots: ImageSlot[] = [];
  for (let i = 0; i < total; i++) {
    if (i < pickedClipUrls.length) {
      slots.push({
        promptIndex: i,
        source: "library",
        state: "video_ready",
        videoUrl: pickedClipUrls[i],
      });
    } else {
      const aiIdx = (i - pickedClipUrls.length) % VIDEO_PROMPT_COUNT;
      slots.push({
        promptIndex: i,
        source: "ai",
        aiPromptIndex: aiIdx as VideoSourcePromptIndex,
        state: "queued",
      });
    }
  }
  return slots;
}

// Kick off a new batch:
//   1. Reset slot + video state, fire script generation in parallel.
//   2. Sequentially generate images 0..4. Each one ends in awaiting_approval
//      and waits for the user. (See approveImage / rejectImage below.)
export async function generateVideoBatch(): Promise<void> {
  const store = useBatchStore.getState();
  const { language, selectedMessageTheme, setLoading, setError, setVideoPosts, setImageSlots } = store;
  // Narration content-type now follows the message theme (used for caption
  // copy + render-route metadata only — the script flavor is theme-driven).
  const contentType = narrationContentTypeFor(selectedMessageTheme);

  setLoading(true);
  setError(null);
  setVideoPosts([]);
  const initialSlots = emptyFromScratchSlots();
  setImageSlots(initialSlots);

  const batchId = `${Date.now()}`;
  _pending = {
    batchId,
    scripts: [],
    language,
    contentType,
    messageTheme: selectedMessageTheme,
    videoUrls: new Map(),
    slotCount: initialSlots.length,
    scriptsResolved: false,
    rendersDispatched: false,
  };

  // Fire script generation in parallel with image gen. Both must resolve
  // before we can dispatch the 3 renders.
  const scriptsPromise = startVideoBatch(language, selectedMessageTheme)
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
    for (const slot of initialSlots) {
      if (slot.source !== "ai") continue;
      await generateImageForSlot(slot.promptIndex, batchId);
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

// Generate an image for the slot at `slotIndex`. Looks up the slot's
// aiPromptIndex from the store to choose which prompt to use.
async function generateImageForSlot(
  slotIndex: number,
  batchId: string,
): Promise<void> {
  const { imageSlots, updateImageSlot } = useBatchStore.getState();
  const slot = imageSlots.find((s) => s.promptIndex === slotIndex);
  if (!slot || slot.source !== "ai" || slot.aiPromptIndex === undefined) return;
  const aiPromptIndex = slot.aiPromptIndex;

  updateImageSlot(slotIndex, { state: "generating", error: undefined });
  try {
    const { url } = await generateSourceImage(aiPromptIndex);
    if (!_pending || _pending.batchId !== batchId) return; // batch was abandoned
    updateImageSlot(slotIndex, {
      state: "awaiting_approval",
      imageUrl: url,
      error: undefined,
    });
  } catch (e) {
    updateImageSlot(slotIndex, {
      state: "failed",
      error: e instanceof Error ? e.message : "image generation failed",
    });
    throw e;
  }
}

// User pressed Approve on a slot. Kick off Seedance animation in the
// background; on completion, record the video URL and try to dispatch the
// 3 renders if everything is ready.
export async function approveImage(slotIndex: number): Promise<void> {
  const { imageSlots, updateImageSlot } = useBatchStore.getState();
  const slot = imageSlots.find((s) => s.promptIndex === slotIndex);
  if (!slot || slot.source !== "ai" || slot.aiPromptIndex === undefined) return;
  if (slot.state !== "awaiting_approval" || !slot.imageUrl) return;
  if (!_pending) return;
  const aiPromptIndex = slot.aiPromptIndex;

  const batchId = _pending.batchId;
  updateImageSlot(slotIndex, { state: "animating", error: undefined });

  try {
    const { url } = await animateSourceImage(slot.imageUrl, modelForPromptIndex(aiPromptIndex));
    const p = _pending;
    if (!p || p.batchId !== batchId) return;
    p.videoUrls.set(slotIndex, url);
    updateImageSlot(slotIndex, { state: "video_ready", videoUrl: url });
    void archiveAnimatedClip({ videoUrl: url, imageUrl: slot.imageUrl, aiPromptIndex, batchId });
    maybeDispatchRenders(batchId);
  } catch (e) {
    updateImageSlot(slotIndex, {
      state: "failed",
      error: e instanceof Error ? e.message : "animation failed",
    });
  }
}

// User pressed Reject. Re-roll the same slot with a new seed.
export async function rejectImage(slotIndex: number): Promise<void> {
  if (!_pending) return;
  const batchId = _pending.batchId;
  await generateImageForSlot(slotIndex, batchId).catch((e) => {
    useBatchStore.getState().setError(e instanceof Error ? e.message : "regenerate failed");
  });
}

// Re-attempt animation on a failed slot without regenerating the image.
export async function retryAnimation(slotIndex: number): Promise<void> {
  const { imageSlots, updateImageSlot } = useBatchStore.getState();
  const slot = imageSlots.find((s) => s.promptIndex === slotIndex);
  if (!slot || !slot.imageUrl) return;
  if (slot.source !== "ai" || slot.aiPromptIndex === undefined) return;
  if (!_pending) return;
  const aiPromptIndex = slot.aiPromptIndex;

  const batchId = _pending.batchId;
  updateImageSlot(slotIndex, { state: "animating", error: undefined });
  try {
    const { url } = await animateSourceImage(slot.imageUrl, modelForPromptIndex(aiPromptIndex));
    const p = _pending;
    if (!p || p.batchId !== batchId) return;
    p.videoUrls.set(slotIndex, url);
    updateImageSlot(slotIndex, { state: "video_ready", videoUrl: url });
    void archiveAnimatedClip({ videoUrl: url, imageUrl: slot.imageUrl, aiPromptIndex, batchId });
    maybeDispatchRenders(batchId);
  } catch (e) {
    updateImageSlot(slotIndex, {
      state: "failed",
      error: e instanceof Error ? e.message : "animation failed",
    });
  }
}

// Render queues — one per active batch. Renders fire serially: only one
// post is in flight at a time, the next is dispatched when the current
// reaches a terminal state. This avoids two ffmpeg processes competing
// on the same Railway worker.

// Per-entry dispatch payload for influencer-mode renders. When set, the
// queue dispatches via /render with mode=influencer (each entry has its
// own shuffled middle clip order); otherwise the entry uses the queue's
// shared clipUrls and the standard narration render path.
interface InfluencerEntryPayload {
  voiceId: string;
  introClipUrl: string;
  introCaptionCutoffPhrase?: string;
  middleClipUrls: string[];
  outroClipUrl: string;
  outroCaptionCutoffPhrase?: string;
  // batchSeed + entry-index, so each render in a batch picks a
  // different music file from the worker's music dir.
  musicShuffleIndex: number;
}

interface RenderQueueEntry {
  postId: string;
  script: string;
  dispatched: boolean;
  influencer?: InfluencerEntryPayload;
}
interface RenderQueue {
  batchId: string;
  language: ReturnType<typeof useBatchStore.getState>["language"];
  contentType: ReturnType<typeof useBatchStore.getState>["contentType"];
  clipUrls: string[];
  entries: RenderQueueEntry[];
  // For narration-mode queues, the avatar voice override that should
  // ride along with every render in the batch (today: Sarah's voice ID).
  // Undefined for influencer queues (those carry their voice per-entry).
  narrationVoiceId?: string;
}
const _renderQueues = new Map<string, RenderQueue>();

function dispatchEntry(queue: RenderQueue, entry: RenderQueueEntry): void {
  entry.dispatched = true;
  const promise = entry.influencer
    ? startInfluencerRender({
        script: entry.script,
        language: queue.language,
        contentType: queue.contentType,
        voiceId: entry.influencer.voiceId,
        introClipUrl: entry.influencer.introClipUrl,
        introCaptionCutoffPhrase: entry.influencer.introCaptionCutoffPhrase,
        middleClipUrls: entry.influencer.middleClipUrls,
        outroClipUrl: entry.influencer.outroClipUrl,
        outroCaptionCutoffPhrase: entry.influencer.outroCaptionCutoffPhrase,
        musicShuffleIndex: entry.influencer.musicShuffleIndex,
      })
    : startVideoRender({
        script: entry.script,
        language: queue.language,
        contentType: queue.contentType,
        clipUrls: queue.clipUrls,
        voiceId: queue.narrationVoiceId,
      });
  promise
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

  // Build clipUrls. For pure picked-clip flow we already have them; for
  // from-scratch and mixed (picked + AI fills) we assemble from the
  // per-slot Map in slotIndex order.
  let clipUrls: string[];
  if (p.pickedClipUrls) {
    clipUrls = p.pickedClipUrls;
  } else {
    if (p.videoUrls.size < p.slotCount) return;
    clipUrls = [];
    for (let i = 0; i < p.slotCount; i++) {
      const url = p.videoUrls.get(i);
      if (!url) return; // unreachable — size check above guarantees presence
      clipUrls.push(url);
    }
  }

  p.rendersDispatched = true;

  const store = useBatchStore.getState();

  // Seed 3 video posts in waiting_images state, then kick off renders.
  // For picked-clip flow placeholders may already exist with the same IDs;
  // setVideoPosts swaps them in place since React keys match.
  const initial: VideoPost[] = p.scripts.map((s, i) => ({
    id: `${batchId}-${i}`,
    angle: s.angle,
    script: s.script,
    caption: s.caption,
    jobId: null,
    state: "waiting_images",
    progress: 0,
    // Stamp the theme on each post so per-card regen stays in the same
    // theme without round-tripping to the store.
    messageTheme: p.messageTheme,
  }));
  store.setVideoPosts(initial);

  // Build the queue and dispatch only the first entry. The rest fire as
  // each in-flight render reaches a terminal state — see advanceRenderQueue.
  const queue: RenderQueue = {
    batchId,
    language: p.language,
    contentType: p.contentType,
    clipUrls,
    narrationVoiceId: narrationVoiceId(),
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
  const { language, selectedMessageTheme, setLoading, setError, setVideoPosts, setImageSlots } = store;
  const contentType = narrationContentTypeFor(selectedMessageTheme);

  setLoading(true);
  setError(null);
  setVideoPosts([]);

  // Seed the slots in video_ready state directly from the saved set.
  // Saved sets are 5-slot from-scratch outputs.
  const slots: ImageSlot[] = Array.from({ length: VIDEO_PROMPT_COUNT }, (_, i) => {
    const cached = set.slots.find((s) => s.promptIndex === i);
    if (cached) {
      return {
        promptIndex: i,
        source: "ai" as const,
        aiPromptIndex: i as VideoSourcePromptIndex,
        state: "video_ready" as const,
        imageUrl: cached.imageUrl,
        videoUrl: cached.videoUrl,
      };
    }
    return {
      promptIndex: i,
      source: "ai" as const,
      aiPromptIndex: i as VideoSourcePromptIndex,
      state: "queued" as const,
    };
  });
  setImageSlots(slots);

  const batchId = `${Date.now()}`;
  _pending = {
    batchId,
    scripts: [],
    language,
    contentType,
    messageTheme: selectedMessageTheme,
    videoUrls: new Map(),
    slotCount: slots.length,
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

  const scriptsPromise = startVideoBatch(language, selectedMessageTheme)
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

// User picked their own clips from the library (or uploaded). Skip image +
// animation entirely; selection-order maps 1:1 to scene-order. Scripts are
// auto-generated like the from-scratch path.
//
// Differences vs from-scratch / saved-set load:
//   - Does NOT seed imageSlots, so the ImageSetPanel (with its "Save set"
//     button) doesn't render. The user goes straight from picking clips to
//     watching the 3 video cards generate.
//   - Seeds 3 placeholder VideoPosts in waiting_images state immediately
//     so the user sees pulsing cards from the moment they click Render
//     (instead of an empty page until scripts arrive).
export async function renderWithPickedClips(clipUrls: string[]): Promise<void> {
  if (clipUrls.length !== PICKED_CLIP_COUNT) {
    throw new Error(`Need ${PICKED_CLIP_COUNT} clips, got ${clipUrls.length}`);
  }

  const store = useBatchStore.getState();
  const { language, selectedMessageTheme, setLoading, setError, setVideoPosts, setImageSlots, clearClipSelection } = store;
  const contentType = narrationContentTypeFor(selectedMessageTheme);

  setLoading(true);
  setError(null);
  setImageSlots([]);

  const batchId = `${Date.now()}`;

  // Seed 3 placeholder video posts so cards render immediately. IDs match
  // what maybeDispatchRenders will produce, so the later setVideoPosts
  // updates these in place via React key reconciliation.
  const placeholderPosts: VideoPost[] = Array.from({ length: 3 }, (_, i) => ({
    id: `${batchId}-${i}`,
    angle: "",
    script: "",
    caption: "",
    jobId: null,
    state: "waiting_images" as const,
    progress: 0,
  }));
  setVideoPosts(placeholderPosts);

  _pending = {
    batchId,
    scripts: [],
    language,
    contentType,
    messageTheme: selectedMessageTheme,
    videoUrls: new Map(),
    slotCount: clipUrls.length,
    pickedClipUrls: clipUrls,
    scriptsResolved: false,
    rendersDispatched: false,
  };

  clearClipSelection();

  const scriptsPromise = startVideoBatch(language, selectedMessageTheme)
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

// Mixed flow: user picked some clips (1..PICKED_CLIP_COUNT-1), the
// remaining slots are AI-generated. Picks fill scenes 1..N as video_ready
// immediately; AI fills cycle through the 5-prompt pool starting at
// prompt 0 and run the standard generate → approve → animate flow,
// just like the from-scratch path.
export async function generateMixedBatch(pickedClipUrls: string[]): Promise<void> {
  if (pickedClipUrls.length === 0 || pickedClipUrls.length >= PICKED_CLIP_COUNT) {
    throw new Error(
      `generateMixedBatch needs 1..${PICKED_CLIP_COUNT - 1} picks, got ${pickedClipUrls.length}`,
    );
  }

  const store = useBatchStore.getState();
  const { language, selectedMessageTheme, setLoading, setError, setVideoPosts, setImageSlots, clearClipSelection } = store;
  const contentType = narrationContentTypeFor(selectedMessageTheme);

  setLoading(true);
  setError(null);
  setVideoPosts([]);

  const initialSlots = buildMixedSlots(pickedClipUrls);
  setImageSlots(initialSlots);

  const batchId = `${Date.now()}`;
  _pending = {
    batchId,
    scripts: [],
    language,
    contentType,
    messageTheme: selectedMessageTheme,
    videoUrls: new Map(),
    slotCount: initialSlots.length,
    scriptsResolved: false,
    rendersDispatched: false,
  };
  // Pre-populate the picked URLs so maybeDispatchRenders only waits on the
  // AI fills (and on scripts).
  for (const slot of initialSlots) {
    if (slot.source === "library" && slot.videoUrl) {
      _pending.videoUrls.set(slot.promptIndex, slot.videoUrl);
    }
  }

  clearClipSelection();

  const scriptsPromise = startVideoBatch(language, selectedMessageTheme)
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

  // Sequential image generation only for the AI slots — picks are already
  // video_ready. Same constraint as from-scratch (fal.ai breaks under
  // concurrency), and same UX (next slot starts while user approves prior).
  try {
    for (const slot of initialSlots) {
      if (slot.source !== "ai") continue;
      await generateImageForSlot(slot.promptIndex, batchId);
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : "image generation failed");
  } finally {
    setLoading(false);
  }

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
      // Saved sets are only ever produced from the 5-slot from-scratch flow
      // (canSave gates this), so promptIndex is in 0..4.
      return {
        promptIndex: slot.promptIndex as VideoSourcePromptIndex,
        imageUrl,
        videoUrl,
      } satisfies SavedSetSlot;
    }),
  );

  return saveSet(name, mirrored);
}

// Fisher-Yates shuffle. Used to randomize the middle clip order for each
// of the 3 influencer videos so the same 8 picks visually cut differently
// across the 3 outputs.
function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

// Influencer mode: 3 renders per click. Same intro, same outro, same 8
// middle picks — but each video uses a different angle from good_agents
// AND a different shuffled order of the middle clips. Renders dispatch
// sequentially via _renderQueues so the Railway worker only runs one
// ffmpeg job at a time.
export async function generateInfluencerBatch(args: {
  avatarName: string;
  introClipUrl: string;
  middleClipUrls: string[];
  outroClipUrl: string;
  messageTheme: MessageTheme;
}): Promise<void> {
  const avatar = getAvatar(args.avatarName);
  if (!avatar) {
    throw new Error(`Unknown avatar: ${args.avatarName}`);
  }
  if (args.middleClipUrls.length !== INFLUENCER_MIDDLE_COUNT) {
    throw new Error(
      `Influencer middle needs exactly ${INFLUENCER_MIDDLE_COUNT} clips, got ${args.middleClipUrls.length}`,
    );
  }

  const store = useBatchStore.getState();
  const {
    language,
    setLoading,
    setError,
    setVideoPosts,
    setImageSlots,
    clearClipSelection,
  } = store;
  // Influencer mode locks the narration content type to good_agents (the
  // matching-mission script) when the active message theme is agent_match.
  // For the dpa theme, generateInfluencerMiddleScripts internally swaps
  // the prompt + caption content type to edu_dpa_local — but it still
  // accepts a contentType argument for backward compat.
  const contentType = "good_agents" as const;

  if (!avatar.supportedLanguages.includes(language)) {
    throw new Error(
      `Avatar "${avatar.name}" does not support ${language}. Update AVATARS.supportedLanguages.`,
    );
  }

  setLoading(true);
  setError(null);
  // Influencer mode skips the image set panel entirely.
  setImageSlots([]);

  const batchId = `inf-${Date.now()}`;

  // Seed 3 placeholder video posts so the cards render immediately while
  // we wait for Claude's 3 scripts to come back.
  const placeholderPosts: VideoPost[] = Array.from({ length: 3 }, (_, i) => ({
    id: `${batchId}-${i}`,
    angle: "influencer",
    script: "",
    caption: "",
    jobId: null,
    state: "waiting_images",
    progress: 0,
    mode: "influencer",
    avatarName: avatar.name,
    introClipUrl: args.introClipUrl,
    outroClipUrl: args.outroClipUrl,
    messageTheme: args.messageTheme,
  }));
  setVideoPosts(placeholderPosts);
  clearClipSelection();
  // Reset bookend selections so the user has a clean slate next click.
  store.setSelectedIntroClipUrl(null);
  store.setSelectedOutroClipUrl(null);

  // Look up the picked bookend clips so we can forward each one's
  // captionCutoffPhrase to the worker. The library is keyed by URL.
  const merged = listMergedLibrary();
  const introClip = merged.find((c) => c.videoUrl === args.introClipUrl);
  const outroClip = merged.find((c) => c.videoUrl === args.outroClipUrl);

  try {
    const scripts = await startInfluencerScript({
      language,
      contentType,
      avatarName: avatar.name,
      messageTheme: args.messageTheme,
    });
    if (scripts.length === 0) {
      throw new Error("Influencer script generation returned no scripts");
    }

    // Truncate or pad the 3 placeholder slots to match how many scripts
    // Claude actually returned (always 3 in practice — this is just a
    // safety net so the UI never references a non-existent script).
    const usableCount = Math.min(scripts.length, placeholderPosts.length);
    // Per-batch seed shifts the music selection across the 3 renders.
    // batchSeed + 0/1/2 maps to 3 distinct music files at the worker
    // (modulo the music dir count). The seed itself varies per batch
    // so different batches pick different music sets.
    const musicBatchSeed = Math.floor(Math.random() * 1_000_000);
    const renderEntries: RenderQueueEntry[] = [];
    for (let i = 0; i < usableCount; i++) {
      const post = placeholderPosts[i]!;
      const script = scripts[i]!;
      // Update the placeholder with the script + angle now that we have it.
      useBatchStore.getState().updateVideoPost(post.id, {
        angle: script.angle,
        script: script.script,
        caption: script.caption,
        state: "queued",
      });
      renderEntries.push({
        postId: post.id,
        script: script.script,
        dispatched: false,
        influencer: {
          voiceId: avatar.voiceId,
          introClipUrl: args.introClipUrl,
          introCaptionCutoffPhrase: introClip?.captionCutoffPhrase,
          // Per-video shuffle of the user's 8 middle picks so each of the
          // 3 rendered videos cuts to a different visual order.
          middleClipUrls: shuffle(args.middleClipUrls),
          outroClipUrl: args.outroClipUrl,
          outroCaptionCutoffPhrase: outroClip?.captionCutoffPhrase,
          musicShuffleIndex: musicBatchSeed + i,
        },
      });
    }
    // If Claude returned fewer scripts than placeholder posts, mark the
    // unused placeholders as failed so the user sees them and can retry.
    for (let i = usableCount; i < placeholderPosts.length; i++) {
      useBatchStore.getState().updateVideoPost(placeholderPosts[i]!.id, {
        state: "failed",
        error: "Script generation returned fewer scripts than expected",
      });
    }

    const queue: RenderQueue = {
      batchId,
      language,
      contentType,
      // clipUrls is unused for influencer entries (each carries its own
      // shuffled middleClipUrls) but the queue type still requires the
      // field. Set it to the un-shuffled picks so it isn't empty.
      clipUrls: args.middleClipUrls,
      entries: renderEntries,
    };
    // Drop any prior queues so old narration-mode renders can't dispatch
    // ghost entries if their polling somehow ticks over after this kicks off.
    _renderQueues.clear();
    _renderQueues.set(batchId, queue);
    if (renderEntries.length > 0) {
      dispatchEntry(queue, renderEntries[0]!);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "influencer render failed";
    for (const post of placeholderPosts) {
      useBatchStore.getState().updateVideoPost(post.id, {
        state: "failed",
        error: message,
      });
    }
    setError(message);
  } finally {
    setLoading(false);
  }
}

// Per-card regeneration. Reuses the existing clipUrls from the live image
// set — only Claude + Railway re-run, no new fal.ai charges.
export async function regenerateOneVideo(postId: string): Promise<void> {
  const state = useBatchStore.getState();
  const post = state.videoPosts.find((v) => v.id === postId);
  if (!post) return;

  // Influencer mode: re-run the same intro/middle/outro pipeline with a
  // fresh middle script. The middle clip URLs are not stored on the post
  // (they come from selectedClipUrls in narration mode but are consumed at
  // dispatch time in influencer mode), so we surface a guidance error if
  // the user has cleared their picks since the last render.
  if (post.mode === "influencer") {
    if (!post.avatarName || !post.introClipUrl || !post.outroClipUrl) {
      state.updateVideoPost(postId, {
        state: "failed",
        error: "Cannot regenerate: missing influencer metadata.",
      });
      return;
    }
    const middleClipUrls = state.selectedClipUrls;
    if (middleClipUrls.length !== INFLUENCER_MIDDLE_COUNT) {
      state.updateVideoPost(postId, {
        state: "failed",
        error:
          "Re-pick the middle filler clips in the library, then click Generate again.",
      });
      return;
    }
    state.updateVideoPost(postId, {
      state: "queued",
      progress: 0,
      jobId: null,
      error: undefined,
      videoUrl: undefined,
    });
    try {
      await generateInfluencerBatch({
        avatarName: post.avatarName,
        introClipUrl: post.introClipUrl,
        middleClipUrls,
        outroClipUrl: post.outroClipUrl,
        // Older posts (from before MessageTheme existed) have no theme
        // stamped — fall back to agent_match so they regenerate the same
        // matching-mission script they were originally rendered against.
        messageTheme: post.messageTheme ?? "agent_match",
      });
    } catch (e) {
      useBatchStore.getState().updateVideoPost(postId, {
        state: "failed",
        error: e instanceof Error ? e.message : "regen failed",
      });
    }
    return;
  }

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
    // Older posts (pre-MessageTheme) lack a stamped theme — default to
    // agent_match so they regenerate into the same script flavor they
    // were originally rendered against.
    const theme: MessageTheme = post.messageTheme ?? "agent_match";
    const fresh = await regenVideo({
      language: state.language,
      messageTheme: theme,
      angleKey: post.angle,
      clipUrls,
      voiceId: narrationVoiceId(),
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
