"use client";

// Funny Commercial v2 — actor library helpers.
//
// Actors are AI-generated portraits saved with a canonical reference
// image. The reference image is what Nano Banana 2 sees as the face
// reference when composing every subsequent shot the actor appears in,
// so swapping reference photos visibly changes the actor across shots.
// Mirrors the shape of src/lib/musicLibrary.ts.

import { getSlice, setSlice } from "./libraryStore";
import type { FcActor } from "./types";

export function listFcActors(): FcActor[] {
  return getSlice("fcActors").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function getFcActor(id: string): FcActor | undefined {
  return getSlice("fcActors").find((a) => a.id === id);
}

export function addFcActor(input: Omit<FcActor, "id" | "savedAt">): FcActor {
  const all = getSlice("fcActors");
  const existing = all.find((a) => a.referenceImageUrl === input.referenceImageUrl);
  if (existing) return existing;
  const entry: FcActor = {
    ...input,
    id: `fc-actor-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  setSlice("fcActors", [...all, entry]);
  return entry;
}

export function renameFcActor(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const all = getSlice("fcActors");
  const idx = all.findIndex((a) => a.id === id);
  if (idx < 0) return;
  const next = all.slice();
  next[idx] = { ...next[idx], name: trimmed };
  setSlice("fcActors", next);
}

export function removeFcActor(id: string): FcActor | undefined {
  const all = getSlice("fcActors");
  const found = all.find((a) => a.id === id);
  if (!found) return undefined;
  setSlice("fcActors", all.filter((a) => a.id !== id));
  return found;
}

export function subscribeFcActors(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("fc-actors-changed", handler);
  return () => window.removeEventListener("fc-actors-changed", handler);
}
