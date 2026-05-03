"use client";

import { useEffect, useState } from "react";

interface PendingUpdate {
  id: string;
  text: string;
  scheduledAtSec: number | null;
  status: string;
  service: string;
  profileId: string;
  profileUsername?: string;
  videoThumbnailUrl?: string;
}

const SERVICE_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

function formatScheduled(sec: number | null): string {
  if (!sec) return "Queue · next slot";
  const d = new Date(sec * 1000);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Calendar / pipeline view of every pending post across the configured
// Buffer profiles. Lets the user delete posts inline; reschedule still
// happens via Buffer's own UI (one tap from here, since rebuilding their
// drag-drop calendar isn't worth it).
export function BufferQueueModal({ onClose }: { onClose: () => void }) {
  const [updates, setUpdates] = useState<PendingUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/social/buffer/pending", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? `Lookup failed (${res.status})`);
          setUpdates([]);
          return;
        }
        setUpdates(Array.isArray(json.updates) ? json.updates : []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "lookup failed");
        setUpdates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onDelete(update: PendingUpdate) {
    if (!window.confirm(`Delete this scheduled post?\n\n${update.text.slice(0, 120)}`)) return;
    setDeletingId(update.id);
    try {
      const res = await fetch("/api/social/buffer/destroy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updateId: update.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Delete failed (${res.status})`);
      setUpdates((prev) => (prev ?? []).filter((u) => u.id !== update.id));
    } catch (err) {
      window.alert(`Delete failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-neutral-950 rounded-3xl border border-neutral-200 dark:border-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-900 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Scheduled posts</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Across every connected Buffer profile.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setRefreshTick((n) => n + 1)}
              className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
              title="Refresh"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
              aria-label="Close"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="p-5 overflow-y-auto">
          {error && (
            <p className="text-[12px] text-red-500 leading-snug mb-4">{error}</p>
          )}
          {updates === null ? (
            <p className="text-[12px] text-neutral-500 text-center py-8">Loading…</p>
          ) : updates.length === 0 ? (
            <p className="text-[12px] text-neutral-500 text-center py-8 leading-snug">
              No scheduled posts. Hit <span className="font-medium">Send to Buffer</span> on a video card to add one.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {updates.map((u) => (
                <li
                  key={u.id}
                  className="flex items-start gap-3 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-900 bg-neutral-50 dark:bg-neutral-900/50"
                >
                  {u.videoThumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={u.videoThumbnailUrl}
                      alt=""
                      className="w-12 h-16 rounded-lg object-cover bg-neutral-200 dark:bg-neutral-800 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-16 rounded-lg bg-neutral-200 dark:bg-neutral-800 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-700 dark:text-neutral-300">
                        {SERVICE_LABEL[u.service] ?? u.service}
                      </span>
                      {u.profileUsername && (
                        <span className="text-[10px] text-neutral-500 truncate">
                          {u.profileUsername}
                        </span>
                      )}
                      <span className="text-[10px] text-neutral-500 tabular-nums ml-auto">
                        {formatScheduled(u.scheduledAtSec)}
                      </span>
                    </div>
                    <p className="text-[12px] text-neutral-700 dark:text-neutral-300 leading-snug mt-1 line-clamp-3 whitespace-pre-line">
                      {u.text}
                    </p>
                  </div>
                  <button
                    onClick={() => onDelete(u)}
                    disabled={deletingId === u.id}
                    className="text-[11px] text-neutral-400 hover:text-red-500 transition shrink-0 disabled:opacity-50"
                    title="Delete"
                  >
                    {deletingId === u.id ? "…" : (
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
