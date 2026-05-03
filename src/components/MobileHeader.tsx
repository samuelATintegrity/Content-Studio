"use client";

import { useBatchStore } from "@/store/batchStore";

// Slim mobile-only header bar shown above the main content. Hosts the
// hamburger that opens the sidebar drawer + the format aspect badge so
// users always know whether they're producing 4:5 statics or 9:16 video
// even with the sidebar collapsed.
export function MobileHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const format = useBatchStore((s) => s.format);
  const aspectBadge = format === "video" ? "9:16" : "4:5";
  return (
    <header className="lg:hidden sticky top-0 z-20 flex items-center justify-between gap-3 px-4 h-12 border-b border-neutral-200 dark:border-neutral-900 bg-white/95 dark:bg-neutral-950/95 backdrop-blur">
      <button
        type="button"
        onClick={onMenuClick}
        aria-label="Open menu"
        className="-ml-2 p-2 rounded-xl text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <h1 className="text-[13px] font-semibold tracking-tight">Content Studio</h1>
      <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-600 font-semibold tabular-nums w-10 text-right">
        {aspectBadge}
      </span>
    </header>
  );
}
