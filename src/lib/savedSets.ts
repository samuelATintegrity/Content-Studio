"use client";

import { getSlice, setSlice } from "./libraryStore";
import type { VideoSourcePromptIndex } from "./types";

export interface SavedSetSlot {
  promptIndex: VideoSourcePromptIndex;
  imageUrl: string;  // R2-mirrored, persistent
  videoUrl: string;  // R2-mirrored, persistent
}

export interface SavedSet {
  id: string;
  name: string;
  savedAt: number;
  slots: SavedSetSlot[];
}

export function listSavedSets(): SavedSet[] {
  return getSlice("sets").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function getSavedSet(id: string): SavedSet | undefined {
  return getSlice("sets").find((s) => s.id === id);
}

export function saveSet(name: string, slots: SavedSetSlot[]): SavedSet {
  const sets = getSlice("sets");
  const set: SavedSet = {
    id: `set-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: name.trim() || `Set saved ${new Date().toLocaleString()}`,
    savedAt: Date.now(),
    slots,
  };
  setSlice("sets", [...sets, set]);
  return set;
}

export function deleteSavedSet(id: string): void {
  const sets = getSlice("sets");
  setSlice("sets", sets.filter((s) => s.id !== id));
}

// Subscribe to in-page changes (saves, deletes from any component).
export function subscribeSavedSets(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("video-saved-sets-changed", handler);
  return () => {
    window.removeEventListener("video-saved-sets-changed", handler);
  };
}
