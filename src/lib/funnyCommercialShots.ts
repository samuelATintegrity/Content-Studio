"use client";

// Funny Commercial v2 — shot library helpers.
//
// A "shot" is one storyboard beat. It starts as a still image (composed
// by Nano Banana 2 with optional actor + location references) and is
// animated to a 5-second clip by Veo 3.1. After animation, the worker
// extracts the last frame and stores it on the shot record so future
// actor shots can seed continuity from it.
//
// Shots are flat across both kinds (actor / crazy). The new flow's UI
// filters by kind when it needs to.

import { getSlice, setSlice } from "./libraryStore";
import type { FcShot, FcShotKind } from "./types";

export function listFcShots(): FcShot[] {
  return getSlice("fcShots").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function listFcShotsByKind(kind: FcShotKind): FcShot[] {
  return listFcShots().filter((s) => s.kind === kind);
}

export function getFcShot(id: string): FcShot | undefined {
  return getSlice("fcShots").find((s) => s.id === id);
}

// Latest animated actor shot, used for the per-shot continuity toggle:
// when the user composes a new actor shot with continuity ON, we seed
// Veo from this shot's lastFrameImageUrl.
export function latestAnimatedActorShot(actorId?: string): FcShot | undefined {
  const all = listFcShots();
  for (const s of all) {
    if (s.kind !== "actor") continue;
    if (!s.videoUrl || !s.lastFrameImageUrl) continue;
    if (actorId && s.actorId !== actorId) continue;
    return s;
  }
  return undefined;
}

export function addFcShot(input: Omit<FcShot, "id" | "savedAt"> & { id?: string }): FcShot {
  const all = getSlice("fcShots");
  const id = input.id ?? `fc-shot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // Replace-by-id semantics so updateFcShot can route through here too.
  const without = all.filter((s) => s.id !== id);
  const entry: FcShot = {
    ...input,
    id,
    savedAt: Date.now(),
  };
  setSlice("fcShots", [...without, entry]);
  return entry;
}

// Patch a specific shot in place. Used by the animate flow to attach
// videoUrl + lastFrameImageUrl to a still that's already in the
// library.
export function updateFcShot(id: string, patch: Partial<FcShot>): FcShot | undefined {
  const all = getSlice("fcShots");
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return undefined;
  const next = all.slice();
  next[idx] = { ...next[idx], ...patch };
  setSlice("fcShots", next);
  return next[idx];
}

export function removeFcShot(id: string): FcShot | undefined {
  const all = getSlice("fcShots");
  const found = all.find((s) => s.id === id);
  if (!found) return undefined;
  setSlice("fcShots", all.filter((s) => s.id !== id));
  return found;
}

export function subscribeFcShots(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("fc-shots-changed", handler);
  return () => window.removeEventListener("fc-shots-changed", handler);
}
