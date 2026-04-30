"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  addLibraryClip,
  listMergedLibrary,
  subscribeMergedLibrary,
  type MergedClip,
} from "@/lib/clipLibrary";
import { uploadClip } from "@/lib/videoClient";

export function ClipLibraryGrid() {
  const [clips, setClips] = useState<MergedClip[]>(() => listMergedLibrary());
  const selectedKeys = useBatchStore((s) => s.selectedClipKeys);
  const selectClip = useBatchStore((s) => s.selectClip);
  const clearClipSelection = useBatchStore((s) => s.clearClipSelection);

  useEffect(() => {
    return subscribeMergedLibrary(() => setClips(listMergedLibrary()));
  }, []);

  const selectedCount = selectedKeys.length;
  const atCap = selectedCount >= 5;

  return (
    <section className="mt-8">
      <header className="flex items-baseline justify-between mb-3 px-1">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
          Clip library · {clips.length} {clips.length === 1 ? "clip" : "clips"}
        </h3>
        <div className="flex items-center gap-2">
          {selectedCount === 5 && (
            <span className="text-[11px] font-semibold text-emerald-500 tabular-nums">
              5 / 5 ready
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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        <UploadTile />
        {clips.map((clip) => {
          const idx = selectedKeys.indexOf(clip.key);
          const selected = idx >= 0;
          return (
            <ClipTile
              key={clip.key}
              clip={clip}
              selectionNumber={selected ? idx + 1 : null}
              dim={!selected && atCap}
              onClick={() => selectClip(clip.key, clip.videoUrl)}
            />
          );
        })}
      </div>

      {clips.length === 0 && (
        <p className="mt-3 text-[11px] text-neutral-500 px-1">
          Your library will fill up automatically as you generate clips from scratch.
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
}: {
  clip: MergedClip;
  selectionNumber: number | null;
  dim: boolean;
  onClick: () => void;
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
    <button
      type="button"
      onClick={onClick}
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

      {/* Origin chip */}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
        <div className="text-[10px] font-medium text-white/95 truncate">
          {originLabel}
        </div>
      </div>
    </button>
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
