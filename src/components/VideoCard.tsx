"use client";

import { useState } from "react";
import type { VideoJobState, VideoPost } from "@/lib/types";
import { useVideoPolling } from "@/lib/useVideoPolling";
import { regenerateOneVideo } from "@/lib/generateVideo";

const STAGE_LABELS: Record<VideoJobState, string> = {
  waiting_images: "Waiting for image set",
  queued: "Queued",
  tts: "Voicing narration",
  footage: "Loading clips",
  rendering: "Rendering video",
  uploading: "Uploading",
  ready: "Ready",
  failed: "Failed",
};

export function VideoCard({ post }: { post: VideoPost }) {
  // Per-card poll loop. Stops on terminal state.
  useVideoPolling(post.id);

  const [captionCopied, setCaptionCopied] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  const isWorking =
    post.state === "waiting_images" ||
    post.state === "queued" ||
    post.state === "tts" ||
    post.state === "footage" ||
    post.state === "rendering" ||
    post.state === "uploading";

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(post.caption);
      setCaptionCopied(true);
      setTimeout(() => setCaptionCopied(false), 1400);
    } catch {
      // ignore
    }
  }

  async function onRegen() {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await regenerateOneVideo(post.id);
    } finally {
      setRegenBusy(false);
    }
  }

  return (
    <div className="rounded-3xl overflow-hidden border bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-900 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.08)] flex flex-col">
      <div className="aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative group">
        {post.state === "ready" && post.videoUrl ? (
          <ReadyVideo url={post.videoUrl} onRegen={onRegen} regenBusy={regenBusy} />
        ) : post.state === "failed" ? (
          <FailedState error={post.error} onRetry={onRegen} regenBusy={regenBusy} />
        ) : (
          <WorkingState state={post.state} progress={post.progress} />
        )}
      </div>

      <div className="p-4 relative group/caption">
        <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-line line-clamp-6">
          {post.caption}
        </p>
        {!isWorking && (
          <>
            {/* Desktop: full overlay revealed on hover. */}
            <button
              onClick={copyCaption}
              className="hidden lg:flex absolute inset-0 m-3 rounded-2xl bg-neutral-900/85 dark:bg-white/85 backdrop-blur-sm text-white dark:text-neutral-900 text-xs font-semibold tracking-tight opacity-0 group-hover/caption:opacity-100 transition items-center justify-center"
            >
              {captionCopied ? "Copied" : "Copy caption"}
            </button>
            {/* Mobile: small persistent corner button so the caption stays readable. */}
            <button
              onClick={copyCaption}
              className="lg:hidden absolute top-2 right-2 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-neutral-900/85 dark:bg-white/85 backdrop-blur-sm text-white dark:text-neutral-900"
            >
              {captionCopied ? "Copied" : "Copy"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function WorkingState({ state, progress }: { state: VideoJobState; progress: number }) {
  const pct = Math.min(100, Math.max(2, Math.round(progress * 100)));
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6">
      <div className="w-10 h-10 rounded-full border border-neutral-300 dark:border-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-600">
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {STAGE_LABELS[state]}
      </div>
      <div className="w-full max-w-[180px] h-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div
          className="h-full bg-neutral-900 dark:bg-white transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ReadyVideo({
  url,
  onRegen,
  regenBusy,
}: {
  url: string;
  onRegen: () => void;
  regenBusy: boolean;
}) {
  return (
    <>
      <video
        src={url}
        controls
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute top-3 right-3 flex gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition pointer-events-auto lg:pointer-events-none lg:group-hover:pointer-events-auto">
        <a
          href={url}
          download
          className="px-3 py-1.5 rounded-full bg-neutral-900/85 backdrop-blur-sm text-white text-xs font-semibold tracking-tight hover:bg-neutral-900"
        >
          Download
        </a>
        <button
          onClick={onRegen}
          disabled={regenBusy}
          className="px-3 py-1.5 rounded-full bg-neutral-900/85 backdrop-blur-sm text-white text-xs font-semibold tracking-tight hover:bg-neutral-900 disabled:opacity-60"
        >
          {regenBusy ? "…" : "Regen"}
        </button>
      </div>
    </>
  );
}

function FailedState({
  error,
  onRetry,
  regenBusy,
}: {
  error: string | undefined;
  onRetry: () => void;
  regenBusy: boolean;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center text-red-500">
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </div>
      <div className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Render failed</div>
      {error && (
        <div className="text-[10px] text-neutral-500 dark:text-neutral-500 leading-snug max-w-[220px] line-clamp-3">
          {error}
        </div>
      )}
      <button
        onClick={onRetry}
        disabled={regenBusy}
        className="mt-1 px-3 py-1.5 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-semibold tracking-tight disabled:opacity-60"
      >
        {regenBusy ? "Retrying" : "Retry"}
      </button>
    </div>
  );
}
