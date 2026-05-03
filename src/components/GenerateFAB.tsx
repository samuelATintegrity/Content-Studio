"use client";

import { useBatchStore } from "@/store/batchStore";
import { generateBatch } from "@/lib/generate";
import {
  generateInfluencerBatch,
  generateMixedBatch,
  generateVideoBatch,
  renderWithPickedClips,
} from "@/lib/generateVideo";
import {
  INFLUENCER_MIDDLE_COUNT,
  PICKED_CLIP_COUNT,
} from "@/lib/videoPrompts";

export function GenerateFAB() {
  const loading = useBatchStore((s) => s.loading);
  const hasPosts = useBatchStore((s) => s.posts.length > 0);
  const hasVideos = useBatchStore((s) => s.videoPosts.length > 0);
  const imageSlots = useBatchStore((s) => s.imageSlots);
  const format = useBatchStore((s) => s.format);
  const selectedClipUrls = useBatchStore((s) => s.selectedClipUrls);
  const subMode = useBatchStore((s) => s.subMode);
  const selectedAvatarName = useBatchStore((s) => s.selectedAvatarName);
  const selectedIntroClipUrl = useBatchStore((s) => s.selectedIntroClipUrl);
  const selectedOutroClipUrl = useBatchStore((s) => s.selectedOutroClipUrl);
  const selectedMessageTheme = useBatchStore((s) => s.selectedMessageTheme);
  const isVideo = format === "video";
  const isInfluencer = isVideo && subMode === "influencer";
  const selectedCount = selectedClipUrls.length;

  // Block re-trigger while an image set is mid-flight (any slot not finished
  // and not in failed state) so we don't lose work to a stray double-click.
  const imageSetBusy =
    imageSlots.length > 0 &&
    imageSlots.some(
      (s) => s.state !== "video_ready" && s.state !== "failed",
    );

  const isPicking = isVideo && selectedCount > 0;
  const canRenderPicked = isVideo && !isInfluencer && selectedCount === PICKED_CLIP_COUNT;
  const canRenderMixed =
    isVideo && !isInfluencer && selectedCount > 0 && selectedCount < PICKED_CLIP_COUNT;
  const aiFillCount = canRenderMixed ? PICKED_CLIP_COUNT - selectedCount : 0;

  // Influencer flow gating. Each branch returns its own label/disabled.
  let influencerLabel: string | null = null;
  let influencerReady = false;
  if (isInfluencer) {
    if (!selectedAvatarName) {
      influencerLabel = "Pick an avatar";
    } else if (!selectedIntroClipUrl) {
      influencerLabel = "Pick an intro clip";
    } else if (selectedCount < INFLUENCER_MIDDLE_COUNT) {
      const need = INFLUENCER_MIDDLE_COUNT - selectedCount;
      influencerLabel = `Pick ${need} more middle clip${need === 1 ? "" : "s"}`;
    } else if (!selectedOutroClipUrl) {
      influencerLabel = "Pick an outro clip";
    } else {
      influencerLabel = `Render influencer (${INFLUENCER_MIDDLE_COUNT} middle)`;
      influencerReady = true;
    }
  }

  const disabled =
    loading ||
    (isVideo && imageSetBusy) ||
    (isInfluencer && !influencerReady);

  function onClick() {
    if (disabled) return;
    if (isInfluencer) {
      if (!influencerReady) return;
      if (
        !selectedAvatarName ||
        !selectedIntroClipUrl ||
        !selectedOutroClipUrl
      ) {
        return;
      }
      void generateInfluencerBatch({
        avatarName: selectedAvatarName,
        introClipUrl: selectedIntroClipUrl,
        middleClipUrls: selectedClipUrls,
        outroClipUrl: selectedOutroClipUrl,
        messageTheme: selectedMessageTheme,
      });
      return;
    }
    if (isVideo) {
      if (canRenderPicked) {
        void renderWithPickedClips(selectedClipUrls);
        return;
      }
      if (canRenderMixed) {
        void generateMixedBatch(selectedClipUrls);
        return;
      }
      void generateVideoBatch();
      return;
    }
    void generateBatch();
  }

  let label: string;
  if (loading) label = isVideo ? "Starting batch" : "Generating";
  else if (isVideo && imageSetBusy) label = "Image set in progress";
  else if (isInfluencer) label = influencerLabel ?? "Render influencer";
  else if (canRenderPicked) label = "Render with selected";
  else if (canRenderMixed) label = `Generate (${selectedCount} pick${selectedCount === 1 ? "" : "s"} + ${aiFillCount} AI)`;
  else if (isVideo) label = hasVideos ? "Regenerate batch" : "Generate from scratch";
  else label = hasPosts ? "Regenerate" : "Generate posts";

  // suppress unused-var lint if isPicking ever drops out below
  void isPicking;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="fixed right-6 z-30 px-6 py-3.5 rounded-full bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold tracking-tight shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)] hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.45)] transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2.5 bottom-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      {loading ? (
        <>
          <Spinner />
          <span>{label}</span>
        </>
      ) : (
        <span>{label}</span>
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      className="w-3.5 h-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
