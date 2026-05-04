"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/types";
import { InlineDateTimePicker } from "./InlineDateTimePicker";

type SocialPlatform = "facebook" | "instagram" | "tiktok";
// Buffer's GraphQL API only supports addToQueue and customScheduled.
// The legacy v1 "Post now" / "Save as draft" modes are gone.
type ScheduleMode = "queue" | "scheduled";

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

interface AvailableResponse {
  language: Language;
  platforms: SocialPlatform[];
  error?: string;
}

interface QueueResponse {
  ok?: boolean;
  queued?: Array<{ platform: SocialPlatform; profileId: string }>;
  updateIds?: string[];
  error?: string;
}

// Convert a datetime-local string ("2026-05-02T10:30") to unix seconds.
// Native datetime-local lacks a timezone — JS interprets it as local time
// which matches the user's intent ("schedule at 10:30 my time").
function localStringToUnixSec(local: string): number | null {
  if (!local) return null;
  const ms = new Date(local).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

// Build a default "now + 1 hour" datetime-local string (YYYY-MM-DDTHH:mm)
// in the user's local timezone for the schedule input's initial value.
function defaultScheduledLocal(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BufferSendModal({
  language,
  videoUrl,
  imageUrl,
  caption: initialCaption,
  onClose,
  onSuccess,
}: {
  language: Language;
  // Exactly one of videoUrl / imageUrl. Video posts go out as reels
  // on FB+IG; image posts as feed posts (and TikTok is filtered out
  // server-side since Buffer's API doesn't accept still images there).
  videoUrl?: string;
  imageUrl?: string;
  caption: string;
  onClose: () => void;
  onSuccess: (queued: { platform: SocialPlatform }[], mode: ScheduleMode) => void;
}) {
  const [caption, setCaption] = useState(initialCaption);
  const [available, setAvailable] = useState<SocialPlatform[] | null>(null);
  const [availableError, setAvailableError] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<SocialPlatform>>(new Set());
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("queue");
  const [scheduledLocal, setScheduledLocal] = useState<string>(() => defaultScheduledLocal());
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Fetch the platforms mapped for this video's language, then default
  // every available platform to checked. Image posts can't go to TikTok
  // (Buffer's API rejects still images there) so hide the pill upfront.
  const isImage = Boolean(imageUrl);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/social/buffer/available?language=${encodeURIComponent(language)}`);
        const json = (await res.json()) as AvailableResponse;
        if (cancelled) return;
        if (!res.ok) {
          setAvailableError(json.error ?? `Lookup failed (${res.status})`);
          setAvailable([]);
          return;
        }
        const filtered = isImage ? json.platforms.filter((p) => p !== "tiktok") : json.platforms;
        setAvailable(filtered);
        setSelectedPlatforms(new Set(filtered));
      } catch (err) {
        if (cancelled) return;
        setAvailableError(err instanceof Error ? err.message : "lookup failed");
        setAvailable([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [language, isImage]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const charCount = caption.length;
  const tiktokOver = charCount > 300 && selectedPlatforms.has("tiktok");

  const sendDisabled = useMemo(() => {
    if (sending) return true;
    if (!caption.trim()) return true;
    if (!available || selectedPlatforms.size === 0) return true;
    if (scheduleMode === "scheduled") {
      const sec = localStringToUnixSec(scheduledLocal);
      if (!sec || sec * 1000 < Date.now()) return true;
    }
    return false;
  }, [sending, caption, available, selectedPlatforms, scheduleMode, scheduledLocal]);

  function togglePlatform(p: SocialPlatform) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function onSend() {
    if (sendDisabled) return;
    setSending(true);
    setSendError(null);
    try {
      const body: Record<string, unknown> = {
        language,
        caption: caption.trim(),
        platforms: Array.from(selectedPlatforms),
        scheduleMode,
      };
      if (videoUrl) body.videoUrl = videoUrl;
      else if (imageUrl) body.imageUrl = imageUrl;
      if (scheduleMode === "scheduled") {
        body.scheduledAtSec = localStringToUnixSec(scheduledLocal);
      }
      const res = await fetch("/api/social/buffer/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as QueueResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Send failed (${res.status})`);
      }
      onSuccess(json.queued ?? [], scheduleMode);
      onClose();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "send failed");
    } finally {
      setSending(false);
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
      <div className="w-full max-w-lg bg-white dark:bg-neutral-950 rounded-3xl border border-neutral-200 dark:border-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-900 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Send to Buffer</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">Language: {language.toUpperCase()}</p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="p-5 flex flex-col gap-5 overflow-y-auto">
          {/* Caption editor */}
          <label className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Caption
              </span>
              <span
                className={`text-[10px] tabular-nums ${
                  tiktokOver ? "text-red-500 font-semibold" : "text-neutral-500"
                }`}
              >
                {charCount} chars{tiktokOver ? " · over TikTok 300 limit" : ""}
              </span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm leading-relaxed font-mono focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600 resize-none"
            />
          </label>

          {/* Channels */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              Channels
            </span>
            {available === null ? (
              <p className="text-[12px] text-neutral-500">Loading…</p>
            ) : available.length === 0 ? (
              <p className="text-[12px] text-red-500 leading-snug">
                {availableError ?? `No Buffer profiles mapped for ${language.toUpperCase()}. Set BUFFER_PROFILE_MAP_JSON.`}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {available.map((p) => {
                  const checked = selectedPlatforms.has(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePlatform(p)}
                      className={`text-[12px] px-3 py-2 rounded-full border transition flex items-center gap-1.5 ${
                        checked
                          ? "bg-neutral-900 border-neutral-900 text-white dark:bg-white dark:border-white dark:text-neutral-900 font-semibold"
                          : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300"
                      }`}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${
                          checked
                            ? "bg-white border-white text-neutral-900 dark:bg-neutral-900 dark:border-neutral-900 dark:text-white"
                            : "border-neutral-400 dark:border-neutral-600"
                        }`}
                      >
                        {checked && (
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                      {PLATFORM_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              When
            </span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { mode: "queue" as const,     label: "Add to queue" },
                  { mode: "scheduled" as const, label: "Pick a time" },
                ]
              ).map(({ mode, label }) => (
                <button
                  key={mode}
                  onClick={() => setScheduleMode(mode)}
                  className={`text-[12px] px-3 py-2 rounded-full border transition ${
                    scheduleMode === mode
                      ? "bg-neutral-900 border-neutral-900 text-white dark:bg-white dark:border-white dark:text-neutral-900 font-semibold"
                      : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {scheduleMode === "scheduled" && (
              <InlineDateTimePicker
                value={scheduledLocal}
                onChange={setScheduledLocal}
                minDate={new Date()}
              />
            )}
            <p className="text-[11px] text-neutral-500 leading-snug">
              {scheduleMode === "queue" && "Adds to each channel's auto-queue, posting at the channel's next scheduled slot."}
              {scheduleMode === "scheduled" && "Posts at the time above (your local timezone)."}
            </p>
          </div>

          {sendError && (
            <p className="text-[12px] text-red-500 leading-snug">{sendError}</p>
          )}
        </div>

        <footer className="px-5 py-4 border-t border-neutral-200 dark:border-neutral-900 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-900 dark:text-neutral-100 transition disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={onSend}
            disabled={sendDisabled}
            className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {sending && (
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
            Send
          </button>
        </footer>
      </div>
    </div>
  );
}
