"use client";

import { useBatchStore } from "@/store/batchStore";
import { generateBatch } from "@/lib/generate";

export function GenerateFAB() {
  const loading = useBatchStore((s) => s.loading);
  const hasPosts = useBatchStore((s) => s.posts.length > 0);
  const format = useBatchStore((s) => s.format);
  const isVideo = format === "video";

  // Video pipeline isn't wired up yet — keep the button visible but disabled,
  // with a tooltip telling the user where things stand.
  const disabled = loading || isVideo;

  function onClick() {
    if (loading || isVideo) return;
    generateBatch();
  }

  let label: string;
  if (loading) label = "Generating";
  else if (isVideo) label = "Video coming soon";
  else label = hasPosts ? "Regenerate" : "Generate posts";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={isVideo ? "Video render pipeline is under construction" : undefined}
      className="fixed bottom-6 right-6 z-30 px-6 py-3.5 rounded-full bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 text-sm font-semibold tracking-tight shadow-[0_8px_24px_-6px_rgba(0,0,0,0.35)] hover:shadow-[0_12px_32px_-8px_rgba(0,0,0,0.45)] transition disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2.5"
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
