"use client";

// Placeholder until the video pipeline ships. Renders a card-shaped slot with
// the same dimensions as a 9:16 short-form video preview, plus a "coming soon"
// state. Phase E will replace this with the real video card (state machine for
// queued/rendering/ready/failed, embedded <video> player, hover Edit + Download).

export function VideoCard() {
  return (
    <div className="rounded-3xl overflow-hidden border bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-900 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.08)] flex flex-col">
      <div className="aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full border border-neutral-300 dark:border-neutral-800 flex items-center justify-center text-neutral-400 dark:text-neutral-600 mb-3">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
          <div className="text-xs text-neutral-500 font-medium">Video pipeline coming soon</div>
        </div>
      </div>
    </div>
  );
}
