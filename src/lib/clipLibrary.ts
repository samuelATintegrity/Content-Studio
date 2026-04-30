"use client";

import { listSavedSets, subscribeSavedSets } from "./savedSets";
import type { VideoSourcePromptIndex } from "./types";

const STORAGE_KEY = "video-clip-library";
const SCHEMA_VERSION = 1;
const AUTO_CAP = 200;

export interface LibraryClip {
  id: string;
  url: string;
  posterUrl?: string;
  kind: "auto" | "upload";
  sourcePromptIndex?: VideoSourcePromptIndex;
  batchId?: string;
  filename?: string;
  savedAt: number;
}

interface Stored {
  version: number;
  clips: LibraryClip[];
}

function read(): Stored {
  if (typeof window === "undefined") return { version: SCHEMA_VERSION, clips: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: SCHEMA_VERSION, clips: [] };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.clips)) {
      return { version: SCHEMA_VERSION, clips: [] };
    }
    return parsed as Stored;
  } catch {
    return { version: SCHEMA_VERSION, clips: [] };
  }
}

function write(store: Stored): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent("video-clip-library-changed"));
}

export function listLibraryClips(): LibraryClip[] {
  return read().clips.slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addLibraryClip(input: Omit<LibraryClip, "id" | "savedAt">): LibraryClip {
  const store = read();
  const clip: LibraryClip = {
    ...input,
    id: `clip-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  store.clips.push(clip);

  // Soft cap: prune oldest auto clips first; never prune uploads.
  const autoClips = store.clips.filter((c) => c.kind === "auto");
  if (autoClips.length > AUTO_CAP) {
    autoClips.sort((a, b) => a.savedAt - b.savedAt);
    const drop = new Set(autoClips.slice(0, autoClips.length - AUTO_CAP).map((c) => c.id));
    store.clips = store.clips.filter((c) => !drop.has(c.id));
  }

  write(store);
  return clip;
}

export function removeLibraryClip(id: string): void {
  const store = read();
  store.clips = store.clips.filter((c) => c.id !== id);
  write(store);
}

export function subscribeLibrary(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("video-clip-library-changed", handler);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener("video-clip-library-changed", handler);
    window.removeEventListener("storage", storageHandler);
  };
}

// ── Merged view (auto + upload + saved-set clips) ────────────────────

export interface MergedClip {
  key: string;
  videoUrl: string;
  posterUrl?: string;
  kind: "auto" | "saved" | "upload";
  origin: {
    setId?: string;
    setName?: string;
    promptIndex?: VideoSourcePromptIndex;
    libraryClipId?: string;
    filename?: string;
    batchId?: string;
  };
  savedAt: number;
}

// Flatten library + saved sets into one list. Dedupe by URL, preferring the
// saved-set entry so the human-curated origin label wins.
export function listMergedLibrary(): MergedClip[] {
  const library = listLibraryClips();
  const sets = listSavedSets();

  const byUrl = new Map<string, MergedClip>();

  for (const c of library) {
    byUrl.set(c.url, {
      key: c.id,
      videoUrl: c.url,
      posterUrl: c.posterUrl,
      kind: c.kind,
      origin: {
        libraryClipId: c.id,
        promptIndex: c.sourcePromptIndex,
        batchId: c.batchId,
        filename: c.filename,
      },
      savedAt: c.savedAt,
    });
  }

  for (const set of sets) {
    for (const slot of set.slots) {
      byUrl.set(slot.videoUrl, {
        key: `set:${set.id}:${slot.promptIndex}`,
        videoUrl: slot.videoUrl,
        posterUrl: slot.imageUrl,
        kind: "saved",
        origin: {
          setId: set.id,
          setName: set.name,
          promptIndex: slot.promptIndex,
        },
        savedAt: set.savedAt,
      });
    }
  }

  return Array.from(byUrl.values()).sort((a, b) => b.savedAt - a.savedAt);
}

// Fire cb whenever either library localStorage OR saved sets change.
export function subscribeMergedLibrary(cb: () => void): () => void {
  const a = subscribeLibrary(cb);
  const b = subscribeSavedSets(cb);
  return () => {
    a();
    b();
  };
}
