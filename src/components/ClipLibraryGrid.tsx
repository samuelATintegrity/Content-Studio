"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  addLibraryClip,
  listMergedLibrary,
  removeLibraryClip,
  subscribeMergedLibrary,
  updateLibraryClip,
  type MergedClip,
} from "@/lib/clipLibrary";
import { listSavedSets } from "@/lib/savedSets";
import { deleteClipFromStorage, tagClip, uploadClip } from "@/lib/videoClient";
import { PICKED_CLIP_COUNT } from "@/lib/videoPrompts";

export function ClipLibraryGrid() {
  const [clips, setClips] = useState<MergedClip[]>(() => listMergedLibrary());
  const [filter, setFilter] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const selectedKeys = useBatchStore((s) => s.selectedClipKeys);
  const selectClip = useBatchStore((s) => s.selectClip);
  const deselectClip = useBatchStore((s) => s.deselectClip);
  const clearClipSelection = useBatchStore((s) => s.clearClipSelection);

  async function onDelete(clip: MergedClip) {
    if (clip.kind === "saved") return; // saved-set clips are governed by sidebar
    const id = clip.origin.libraryClipId;
    if (!id) return;
    const label = clip.kind === "upload" ? clip.origin.filename ?? "this upload" : "this clip";

    // Check if any saved set references this video URL — deleting the file
    // from R2 would break those sets. The poster image is set-internal and
    // safe to delete (saved sets carry their own image URLs from R2 too,
    // but clip URL is the load-bearing one for selection).
    const conflictingSets = listSavedSets().filter((s) =>
      s.slots.some((slot) => slot.videoUrl === clip.videoUrl || slot.imageUrl === clip.posterUrl),
    );

    let warning = `Permanently delete ${label}?\n\nThis removes it from your library AND deletes the file from R2 storage.`;
    if (conflictingSets.length > 0) {
      const names = conflictingSets.map((s) => `"${s.name}"`).join(", ");
      warning += `\n\n⚠️ This file is also used by saved set${conflictingSets.length > 1 ? "s" : ""} ${names}. Deleting it will break ${conflictingSets.length > 1 ? "them" : "that set"}.`;
    }
    if (!window.confirm(warning)) return;

    if (selectedKeys.includes(clip.key)) deselectClip(clip.key);
    removeLibraryClip(id);

    const urls = [clip.videoUrl];
    if (clip.posterUrl) urls.push(clip.posterUrl);
    try {
      await deleteClipFromStorage(urls);
    } catch (err) {
      console.error("[clipLibrary] R2 delete failed", err);
      window.alert(`Removed from library, but storage delete failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  useEffect(() => {
    return subscribeMergedLibrary(() => setClips(listMergedLibrary()));
  }, []);

  const selectedCount = selectedKeys.length;
  const atCap = selectedCount >= PICKED_CLIP_COUNT;

  // Build the union of all tags currently in the library, for the filter chips.
  const allTags: string[] = (() => {
    const set = new Set<string>();
    for (const c of clips) {
      if (c.tags) for (const t of c.tags) set.add(t);
    }
    return Array.from(set).sort();
  })();

  // Apply text + tag filters.
  const q = filter.trim().toLowerCase();
  const filteredClips = clips.filter((c) => {
    if (activeTags.size > 0) {
      const tags = c.tags ?? [];
      // AND across selected tag chips: a clip must have ALL selected tags.
      for (const t of activeTags) if (!tags.includes(t)) return false;
    }
    if (q) {
      const haystack = [
        ...(c.tags ?? []),
        c.origin.filename,
        c.origin.setName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
    <section className="mt-8">
      <header className="flex items-baseline justify-between mb-3 px-1">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
          Clip library · {clips.length} {clips.length === 1 ? "clip" : "clips"}
        </h3>
        <div className="flex items-center gap-2">
          {selectedCount === PICKED_CLIP_COUNT && (
            <span className="text-[11px] font-semibold text-emerald-500 tabular-nums">
              {PICKED_CLIP_COUNT} / {PICKED_CLIP_COUNT} ready
            </span>
          )}
          {selectedCount > 0 && (
            <button
              onClick={clearClipSelection}
              className="text-[11px] px-2.5 py-1 rounded-full border border-neutral-300 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
            >
              Clear selection
            </button>
          )}
        </div>
      </header>

      {/* Search + tag-chip filter. Only render when there's anything to filter. */}
      {(clips.length > 0 || filter) && (
        <div className="mb-3 px-1 flex flex-col gap-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search filenames, tags…"
            className="w-full sm:max-w-xs px-3 py-1.5 rounded-full text-[12px] bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
          />
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const active = activeTags.has(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`text-[10px] px-2.5 py-1 rounded-full border transition tabular-nums ${
                      active
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {tag.replace(/_/g, " ")}
                  </button>
                );
              })}
              {activeTags.size > 0 && (
                <button
                  onClick={() => setActiveTags(new Set())}
                  className="text-[10px] px-2.5 py-1 rounded-full text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
                >
                  Clear tags
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        <UploadTile />
        {filteredClips.map((clip) => {
          const idx = selectedKeys.indexOf(clip.key);
          const selected = idx >= 0;
          return (
            <ClipTile
              key={clip.key}
              clip={clip}
              selectionNumber={selected ? idx + 1 : null}
              dim={!selected && atCap}
              onClick={() => selectClip(clip.key, clip.videoUrl)}
              onDelete={clip.kind === "saved" ? undefined : () => onDelete(clip)}
            />
          );
        })}
      </div>

      {clips.length === 0 && (
        <p className="mt-3 text-[11px] text-neutral-500 px-1">
          Your library will fill up automatically as you generate clips from scratch.
        </p>
      )}
      {clips.length > 0 && filteredClips.length === 0 && (
        <p className="mt-3 text-[11px] text-neutral-500 px-1">
          No clips match the current filter.
        </p>
      )}
    </section>
  );
}

function ClipTile({
  clip,
  selectionNumber,
  dim,
  onClick,
  onDelete,
}: {
  clip: MergedClip;
  selectionNumber: number | null;
  dim: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  function onEnter() {
    const v = videoRef.current;
    if (!v) return;
    void v.play().catch(() => undefined);
  }

  function onLeave() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
  }

  const originLabel = (() => {
    if (clip.kind === "saved") {
      return clip.origin.setName ? `From: ${clip.origin.setName}` : "Saved set";
    }
    if (clip.kind === "upload") {
      return clip.origin.filename ?? "Uploaded";
    }
    if (typeof clip.origin.promptIndex === "number") {
      return `Slot ${clip.origin.promptIndex + 1}`;
    }
    return "Auto";
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`group relative aspect-[9/16] rounded-2xl overflow-hidden border bg-neutral-100 dark:bg-neutral-900 transition ${
        selectionNumber !== null
          ? "border-emerald-500 ring-2 ring-emerald-500/40"
          : "border-neutral-200 dark:border-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-700"
      } ${dim ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {clip.posterUrl ? (
        <video
          ref={videoRef}
          src={clip.videoUrl}
          poster={clip.posterUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          src={clip.videoUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover bg-neutral-200 dark:bg-neutral-800"
          onLoadedMetadata={onSeekToFirstFrame}
        />
      )}

      {/* Delete button (auto + upload only; saved-set clips are managed in sidebar) */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
          title="Remove from library"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      {/* Selection badge */}
      <div className="absolute top-2 right-2">
        {selectionNumber !== null ? (
          <div className="w-7 h-7 rounded-full bg-emerald-500 text-white text-[12px] font-bold flex items-center justify-center shadow">
            {selectionNumber}
          </div>
        ) : (
          !dim && (
            <div className="w-7 h-7 rounded-full border-2 border-white/0 group-hover:border-white/80 transition" />
          )
        )}
      </div>

      {/* Origin chip + tags */}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
        <div className="text-[10px] font-medium text-white/95 truncate">
          {originLabel}
        </div>
        {clip.tags && clip.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 max-h-8 overflow-hidden">
            {clip.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/20 text-white/95 backdrop-blur-sm leading-none tabular-nums"
              >
                {t.replace(/_/g, " ")}
              </span>
            ))}
            {clip.tags.length > 4 && (
              <span className="text-[8px] text-white/70 leading-none">+{clip.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function onSeekToFirstFrame(e: SyntheticEvent<HTMLVideoElement>) {
  const v = e.currentTarget;
  try {
    if (v.duration && v.currentTime === 0) v.currentTime = 0.05;
  } catch {
    /* ignore */
  }
}

function UploadTile() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectClip = useBatchStore((s) => s.selectClip);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { cachedUrl, filename } = await uploadClip(file);
      const clip = addLibraryClip({
        url: cachedUrl,
        kind: "upload",
        filename,
      });
      // Auto-select the freshly uploaded clip.
      selectClip(clip.id, cachedUrl);
      // Fire-and-forget tag scan; tags will appear on the tile a few seconds later.
      void tagClip(cachedUrl)
        .then((tags) => updateLibraryClip(clip.id, { tags }))
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => !uploading && inputRef.current?.click()}
      disabled={uploading}
      className="relative aspect-[9/16] rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-800 hover:border-neutral-500 dark:hover:border-neutral-600 bg-neutral-50 dark:bg-neutral-950 transition flex flex-col items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        onChange={onPick}
        className="hidden"
      />
      {uploading ? (
        <>
          <Spinner />
          <span className="text-[11px] font-medium text-neutral-500">Uploading…</span>
        </>
      ) : (
        <>
          <svg
            className="w-6 h-6 text-neutral-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Upload clip
          </span>
        </>
      )}
      {error && (
        <span className="absolute inset-x-2 bottom-2 text-[9px] text-red-500 truncate" title={error}>
          {error}
        </span>
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin text-neutral-500" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
