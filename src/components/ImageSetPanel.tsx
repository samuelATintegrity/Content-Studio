"use client";

import { useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  approveImage,
  rejectImage,
  retryAnimation,
  saveCurrentSet,
} from "@/lib/generateVideo";
import {
  VIDEO_IMAGE_PROMPT_LABELS,
  VIDEO_PROMPT_COUNT,
} from "@/lib/videoPrompts";
import type { ImageSlot, ImageSlotState, VideoSourcePromptIndex } from "@/lib/types";

const STATE_LABELS: Record<ImageSlotState, string> = {
  queued: "Waiting",
  generating: "Generating",
  awaiting_approval: "Approve?",
  animating: "Animating",
  video_ready: "Ready",
  failed: "Failed",
};

export function ImageSetPanel() {
  const imageSlots = useBatchStore((s) => s.imageSlots);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  if (imageSlots.length === 0) return null;

  const readyCount = imageSlots.filter((s) => s.state === "video_ready").length;
  const allReady = readyCount === VIDEO_PROMPT_COUNT;

  async function onSave() {
    if (saving || !allReady) return;
    const proposed = `Set ${new Date().toLocaleString()}`;
    const name = window.prompt("Name this image set so you can reuse it later:", proposed);
    if (!name) return;
    setSaving(true);
    try {
      const set = await saveCurrentSet(name);
      setSavedFlash(`Saved "${set.name}"`);
      setTimeout(() => setSavedFlash(null), 2500);
    } catch (e) {
      window.alert(`Save failed: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-8 rounded-3xl border border-neutral-200 dark:border-neutral-900 bg-white dark:bg-neutral-950 p-5">
      <header className="flex items-baseline justify-between mb-4 gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Image set</h2>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-neutral-500 tabular-nums">
            {readyCount} / {VIDEO_PROMPT_COUNT} ready
          </span>
          {allReady && (
            <button
              onClick={onSave}
              disabled={saving}
              className="px-3 py-1 rounded-full text-[11px] font-semibold tracking-tight bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60 transition"
            >
              {saving ? "Saving…" : savedFlash ?? "Save set"}
            </button>
          )}
        </div>
      </header>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {imageSlots.map((slot) => (
          <Slot key={slot.promptIndex} slot={slot} />
        ))}
      </div>
    </section>
  );
}

function Slot({ slot }: { slot: ImageSlot }) {
  const label = VIDEO_IMAGE_PROMPT_LABELS[slot.promptIndex] ?? `Slot ${slot.promptIndex + 1}`;

  return (
    <div className="relative rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-900 bg-neutral-50 dark:bg-neutral-900">
      <div className="aspect-[9/16] relative">
        {slot.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slot.imageUrl}
            alt={label}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <PlaceholderGlyph state={slot.state} />
          </div>
        )}

        {(slot.state === "generating" || slot.state === "animating") && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Spinner />
          </div>
        )}

        {slot.state === "awaiting_approval" && (
          <ApprovalOverlay promptIndex={slot.promptIndex} />
        )}

        {slot.state === "video_ready" && (
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}

        {slot.state === "failed" && (
          <FailedOverlay
            promptIndex={slot.promptIndex}
            hasImage={!!slot.imageUrl}
            error={slot.error}
          />
        )}
      </div>
      <div className="p-2.5 text-[11px] flex items-baseline justify-between">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">{label}</span>
        <span className="text-neutral-500">{STATE_LABELS[slot.state]}</span>
      </div>
    </div>
  );
}

function ApprovalOverlay({ promptIndex }: { promptIndex: VideoSourcePromptIndex }) {
  return (
    <div className="absolute inset-x-0 bottom-0 p-2 flex gap-2 bg-gradient-to-t from-black/85 to-transparent">
      <button
        onClick={() => rejectImage(promptIndex)}
        className="flex-1 px-2 py-1.5 rounded-full text-[11px] font-semibold tracking-tight bg-white/90 hover:bg-white text-neutral-900 transition"
      >
        Reject
      </button>
      <button
        onClick={() => approveImage(promptIndex)}
        className="flex-1 px-2 py-1.5 rounded-full text-[11px] font-semibold tracking-tight bg-emerald-500 hover:bg-emerald-400 text-white transition"
      >
        Approve
      </button>
    </div>
  );
}

function FailedOverlay({
  promptIndex,
  hasImage,
  error,
}: {
  promptIndex: VideoSourcePromptIndex;
  hasImage: boolean;
  error?: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-3 text-center">
      <div className="text-[11px] font-semibold text-white">Failed</div>
      {error && (
        <div
          className="text-[9px] leading-snug text-white/85 max-h-24 overflow-auto select-text"
          title={error}
        >
          {error.slice(0, 240)}
        </div>
      )}
      <div className="flex gap-2 mt-1">
        <button
          onClick={() => rejectImage(promptIndex)}
          className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white/90 hover:bg-white text-neutral-900"
        >
          New image
        </button>
        {hasImage && (
          <button
            onClick={() => retryAnimation(promptIndex)}
            className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-white"
          >
            Retry animate
          </button>
        )}
      </div>
    </div>
  );
}

function PlaceholderGlyph({ state }: { state: ImageSlotState }) {
  if (state === "queued") {
    return (
      <svg className="w-5 h-5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
