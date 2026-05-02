"use client";

// Shared library of background music tracks. Each track is an mp3 file
// uploaded by a logged-in user, mirrored to R2, and indexed in the same
// library manifest as clips/sets/images. The Railway worker lists the
// music/ R2 prefix at render time and picks deterministically by
// shuffleIndex (same algorithm as the bundled-music path).

import { getSlice, setSlice } from "./libraryStore";

export interface MusicTrack {
  id: string;
  // Public R2 URL of the mp3.
  url: string;
  // Display name (defaults to the upload filename, user-editable later).
  filename: string;
  savedAt: number;
}

export function listMusicTracks(): MusicTrack[] {
  return getSlice("tracks").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addMusicTrack(input: Omit<MusicTrack, "id" | "savedAt">): MusicTrack {
  const tracks = getSlice("tracks");
  // Dedupe by URL — re-uploading the same file (same SHA-256 keying on
  // the server) yields the same R2 URL, so we keep the older entry.
  const existing = tracks.find((t) => t.url === input.url);
  if (existing) return existing;
  const track: MusicTrack = {
    ...input,
    id: `music-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  setSlice("tracks", [...tracks, track]);
  return track;
}

export function removeMusicTrack(id: string): MusicTrack | undefined {
  const tracks = getSlice("tracks");
  const found = tracks.find((t) => t.id === id);
  if (!found) return undefined;
  setSlice("tracks", tracks.filter((t) => t.id !== id));
  return found;
}

export function subscribeMusicLibrary(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("music-library-changed", handler);
  return () => {
    window.removeEventListener("music-library-changed", handler);
  };
}
