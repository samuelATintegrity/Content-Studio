"use client";

// Cache of every AI-generated 4:5 image, mirrored to R2 for persistence
// (fal.ai URLs eventually expire). Used by static-post batches as the
// "previously generated" pool, and by the New-image shuffle to skip
// re-generating images the user has already paid for.

import { getSlice, setSlice } from "./libraryStore";

const SOFT_CAP = 500;

export interface LibraryImage {
  id: string;
  url: string;       // R2-mirrored, persistent
  prompt?: string;   // the AI prompt used to generate it (helps debug / future search)
  category?: string; // optional classification: "family" | "couple" | "exterior" | "interior" | "other"
  savedAt: number;
}

export function listLibraryImages(): LibraryImage[] {
  return getSlice("images").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addLibraryImage(input: Omit<LibraryImage, "id" | "savedAt">): LibraryImage {
  const images = getSlice("images");
  // Dedupe by URL — if the same image was cached before, keep the older entry.
  const existing = images.find((img) => img.url === input.url);
  if (existing) return existing;

  const image: LibraryImage = {
    ...input,
    id: `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  let next = [...images, image];

  // Soft cap — prune oldest. (No protected entries here; all are auto.)
  if (next.length > SOFT_CAP) {
    next = next.slice().sort((a, b) => a.savedAt - b.savedAt).slice(next.length - SOFT_CAP);
  }

  setSlice("images", next);
  return image;
}

export function removeLibraryImage(id: string): void {
  const images = getSlice("images");
  setSlice("images", images.filter((img) => img.id !== id));
}

export function subscribeImageLibrary(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("static-image-library-changed", handler);
  return () => {
    window.removeEventListener("static-image-library-changed", handler);
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
