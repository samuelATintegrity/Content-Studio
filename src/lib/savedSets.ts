"use client";

import type { VideoSourcePromptIndex } from "./types";

const STORAGE_KEY = "video-source-sets";
const SCHEMA_VERSION = 1;

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

interface Stored {
  version: number;
  sets: SavedSet[];
}

function read(): Stored {
  if (typeof window === "undefined") return { version: SCHEMA_VERSION, sets: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: SCHEMA_VERSION, sets: [] };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.sets)) {
      return { version: SCHEMA_VERSION, sets: [] };
    }
    return parsed as Stored;
  } catch {
    return { version: SCHEMA_VERSION, sets: [] };
  }
}

function write(store: Stored): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  // Notify any listeners (in-page) that the saved-set list has changed.
  window.dispatchEvent(new CustomEvent("video-saved-sets-changed"));
}

export function listSavedSets(): SavedSet[] {
  return read().sets.slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function getSavedSet(id: string): SavedSet | undefined {
  return read().sets.find((s) => s.id === id);
}

export function saveSet(name: string, slots: SavedSetSlot[]): SavedSet {
  const store = read();
  const set: SavedSet = {
    id: `set-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: name.trim() || `Set saved ${new Date().toLocaleString()}`,
    savedAt: Date.now(),
    slots,
  };
  store.sets.push(set);
  write(store);
  return set;
}

export function deleteSavedSet(id: string): void {
  const store = read();
  store.sets = store.sets.filter((s) => s.id !== id);
  write(store);
}

// Subscribe to in-page changes (saves, deletes from any component).
export function subscribeSavedSets(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("video-saved-sets-changed", handler);
  // Cross-tab updates via storage event
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener("video-saved-sets-changed", handler);
    window.removeEventListener("storage", storageHandler);
  };
}
