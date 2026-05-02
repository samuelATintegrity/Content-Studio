"use client";

import { useEffect, useRef, useState } from "react";
import {
  addMusicTrack,
  listMusicTracks,
  removeMusicTrack,
  subscribeMusicLibrary,
  type MusicTrack,
} from "@/lib/musicLibrary";

export function MusicLibraryModal({ onClose }: { onClose: () => void }) {
  const [tracks, setTracks] = useState<MusicTrack[]>(() => listMusicTracks());
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeMusicLibrary(() => setTracks(listMusicTracks())), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const res = await fetch("/api/music/upload", {
        method: "POST",
        headers: {
          "content-type": file.type || "audio/mpeg",
          "x-filename": file.name,
        },
        body: file,
      });
      const text = await res.text();
      let body: { cachedUrl?: string; filename?: string; error?: string } = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(`upload returned non-JSON (${res.status})`);
      }
      if (!res.ok) throw new Error(body.error ?? `upload failed (${res.status})`);
      if (!body.cachedUrl || !body.filename) {
        throw new Error("upload returned malformed body");
      }
      addMusicTrack({ url: body.cachedUrl, filename: body.filename });
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(track: MusicTrack) {
    if (!window.confirm(`Permanently delete "${track.filename}"?`)) return;
    const removed = removeMusicTrack(track.id);
    try {
      await fetch("/api/music/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: track.url }),
      });
    } catch (err) {
      console.error("[music] R2 delete failed", err);
      // Roll back the local removal if the server delete failed so the
      // shared manifest doesn't lose track of an existing R2 object.
      if (removed) addMusicTrack({ url: removed.url, filename: removed.filename });
      window.alert(`Delete failed: ${err instanceof Error ? err.message : "unknown"}`);
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
      <div className="w-full max-w-xl bg-white dark:bg-neutral-950 rounded-3xl border border-neutral-200 dark:border-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-900 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Music library</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Background tracks shared across all logged-in users.
            </p>
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

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => !uploading && inputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 transition disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Upload mp3"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="audio/mpeg,audio/mp3,.mp3"
              onChange={onPick}
              className="hidden"
            />
            <span className="text-[11px] text-neutral-500">
              {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
            </span>
          </div>
          {error && (
            <p className="text-[11px] text-red-500 leading-snug">{error}</p>
          )}
          {tracks.length === 0 ? (
            <p className="text-[12px] text-neutral-500 leading-snug py-6 text-center">
              No tracks yet. Upload an mp3 to get started — it&apos;ll be available
              for the next render.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tracks.map((track) => (
                <li
                  key={track.id}
                  className="group flex items-center gap-3 px-3 py-2 rounded-2xl border border-neutral-200 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">
                      {track.filename}
                    </div>
                    <div className="text-[10px] text-neutral-500">
                      {new Date(track.savedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <audio
                    src={track.url}
                    controls
                    preload="none"
                    className="h-8 max-w-[180px]"
                  />
                  <button
                    onClick={() => onDelete(track)}
                    className="opacity-0 group-hover:opacity-100 transition text-neutral-400 hover:text-red-500"
                    title="Delete"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
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
