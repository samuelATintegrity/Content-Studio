"use client";

// Cache of every AI-generated 4:5 image, mirrored to R2 for persistence
// (fal.ai URLs eventually expire). Used by static-post batches as the
// "previously generated" pool, and by the New-image shuffle to skip
// re-generating images the user has already paid for.

const STORAGE_KEY = "static-image-library";
const SCHEMA_VERSION = 1;
const SOFT_CAP = 500;

export interface LibraryImage {
  id: string;
  url: string;       // R2-mirrored, persistent
  prompt?: string;   // the AI prompt used to generate it (helps debug / future search)
  category?: string; // optional classification: "family" | "couple" | "exterior" | "interior" | "other"
  savedAt: number;
}

interface Stored {
  version: number;
  images: LibraryImage[];
}

function read(): Stored {
  if (typeof window === "undefined") return { version: SCHEMA_VERSION, images: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: SCHEMA_VERSION, images: [] };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.images)) {
      return { version: SCHEMA_VERSION, images: [] };
    }
    return parsed as Stored;
  } catch {
    return { version: SCHEMA_VERSION, images: [] };
  }
}

function write(store: Stored): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  window.dispatchEvent(new CustomEvent("static-image-library-changed"));
}

export function listLibraryImages(): LibraryImage[] {
  return read().images.slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addLibraryImage(input: Omit<LibraryImage, "id" | "savedAt">): LibraryImage {
  const store = read();
  // Dedupe by URL — if the same image was cached before, keep the older entry.
  const existing = store.images.find((img) => img.url === input.url);
  if (existing) return existing;

  const image: LibraryImage = {
    ...input,
    id: `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  store.images.push(image);

  // Soft cap — prune oldest. (No protected entries here; all are auto.)
  if (store.images.length > SOFT_CAP) {
    store.images.sort((a, b) => a.savedAt - b.savedAt);
    store.images = store.images.slice(store.images.length - SOFT_CAP);
  }

  write(store);
  return image;
}

export function removeLibraryImage(id: string): void {
  const store = read();
  store.images = store.images.filter((img) => img.id !== id);
  write(store);
}

export function subscribeImageLibrary(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("static-image-library-changed", handler);
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", storageHandler);
  return () => {
    window.removeEventListener("static-image-library-changed", handler);
    window.removeEventListener("storage", storageHandler);
  };
}

// Fisher-Yates pick-N-without-replacement, excluding URLs in `excludeUrls`.
// Returns up to N entries; may return fewer if the pool is smaller.
export function pickRandomLibraryImages(n: number, excludeUrls: string[] = []): LibraryImage[] {
  const all = listLibraryImages().filter((img) => !excludeUrls.includes(img.url));
  if (all.length <= n) return all;
  // Shuffle a copy, take first N.
  const copy = all.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}
