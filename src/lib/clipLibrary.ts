"use client";

import { listSavedSets, subscribeSavedSets } from "./savedSets";
import type { Language, VideoSourcePromptIndex } from "./types";

const STORAGE_KEY = "video-clip-library";
const SCHEMA_VERSION = 1;
const AUTO_CAP = 200;

// Library language tags. "multi" = the clip is visually language-agnostic
// (rooms, exteriors, no people speaking) and works across all narrations.
// "en" | "tl" | "es" | "zh" mirror the app's Language type and are stamped
// at generation time for from-scratch clips.
export type ClipLanguage = Language | "multi";

// Influencer-mode clip role. Undefined = filler (the default for every
// existing clip). Set to "intro" or "outro" via the metadata modal to
// dedicate a clip to an avatar's pre-recorded bookends.
export type ClipRole = "intro" | "outro";

export interface LibraryClip {
  id: string;
  url: string;
  posterUrl?: string;
  kind: "auto" | "upload";
  sourcePromptIndex?: VideoSourcePromptIndex;
  batchId?: string;
  filename?: string;
  savedAt: number;
  // Auto-tags from a vision pass on the first frame. Populated async after
  // add. `undefined` = not yet scanned, `[]` = scanned, no tags inferred.
  tags?: string[];
  // Language tag — auto-set for from-scratch clips (the batch's language at
  // generation time), defaults to "multi" for uploads + AI-generated clips.
  // User can override via the per-tile language pill. Saved-set clips
  // inherit from the LibraryClip when the URL matches; otherwise default
  // to "multi".
  language?: ClipLanguage;
  // Influencer-mode bookend role. Only meaningful when avatarName is also
  // set. Existing clips without these fields behave as filler.
  role?: ClipRole;
  avatarName?: string;
  // Influencer-mode caption cutoff. When this phrase appears in the
  // transcribed bookend audio, ALL words from the cutoff onward are
  // dropped from the burned captions. Used to clear the canvas right
  // before a brand mention so the user can drop a title card on top.
  // Empty / undefined = caption everything.
  captionCutoffPhrase?: string;
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

// Patch a clip in-place. Used by the tag-scan pipeline to attach tags
// without disturbing the rest of the entry. No-op if the clip has been
// removed in the meantime.
export function updateLibraryClip(id: string, patch: Partial<LibraryClip>): void {
  const store = read();
  const idx = store.clips.findIndex((c) => c.id === id);
  if (idx < 0) return;
  store.clips[idx] = { ...store.clips[idx], ...patch, id: store.clips[idx].id };
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
  tags?: string[];
  language?: ClipLanguage;
  role?: ClipRole;
  avatarName?: string;
  captionCutoffPhrase?: string;
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
      tags: c.tags,
      language: c.language,
      role: c.role,
      avatarName: c.avatarName,
      captionCutoffPhrase: c.captionCutoffPhrase,
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
