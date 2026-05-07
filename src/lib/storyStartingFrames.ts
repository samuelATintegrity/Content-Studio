"use client";

// Story Builder — starting-frame library helpers.
//
// The starting-frame library is a project-scoped pool of reusable
// images that can seed a new shot's first frame. It collects entries
// from three sources:
//   - "upload"               — user-supplied via file picker
//   - "generated"            — Nano Banana 2 from a text prompt
//   - "extracted-from-shot"  — auto-deposited last frame of a saved shot
//
// All three coexist in the same listing so the New-shot wizard's
// "Library" picker is a single grid; sources are tracked so the cards
// can carry a small badge if/when we want to filter or dedupe.

import { getSlice, setSlice } from "./libraryStore";
import type { StoryStartingFrame, StoryStartingFrameSource } from "./types";

function newFrameId(): string {
  return `story-frame-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function listStoryStartingFrames(projectId: string): StoryStartingFrame[] {
  return getSlice("storyStartingFrames")
    .filter((f) => f.projectId === projectId)
    .slice()
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function getStoryStartingFrame(id: string): StoryStartingFrame | undefined {
  return getSlice("storyStartingFrames").find((f) => f.id === id);
}

// Lower-level add — used by the more focused helpers below. Skips the
// dedupe check because callers know whether they want it.
function addRaw(input: {
  projectId: string;
  imageUrl: string;
  source: StoryStartingFrameSource;
  sourceShotId?: string;
  prompt?: string;
}): StoryStartingFrame {
  const all = getSlice("storyStartingFrames");
  const entry: StoryStartingFrame = {
    id: newFrameId(),
    projectId: input.projectId,
    imageUrl: input.imageUrl,
    source: input.source,
    sourceShotId: input.sourceShotId,
    prompt: input.prompt,
    savedAt: Date.now(),
  };
  setSlice("storyStartingFrames", [...all, entry]);
  return entry;
}

// Register a user upload. The caller has already mirrored the bytes
// to R2 via /api/story/frame/upload and gotten back a stable url.
export function addUploadedStartingFrame(args: {
  projectId: string;
  imageUrl: string;
}): StoryStartingFrame {
  return addRaw({ ...args, source: "upload" });
}

// Register a freshly-generated frame. The prompt is preserved so the
// library card can show provenance.
export function addGeneratedStartingFrame(args: {
  projectId: string;
  imageUrl: string;
  prompt: string;
}): StoryStartingFrame {
  return addRaw({ ...args, source: "generated" });
}

// Auto-deposit a saved shot's last frame. Idempotent on
// (projectId, sourceShotId) — if a saved shot's last frame is already
// in the library we skip rather than register a duplicate. Lets
// `addStoryShot` call this unconditionally without worrying about the
// reanimate / retry path adding the same frame twice.
export function addStartingFrameFromShot(args: {
  projectId: string;
  sourceShotId: string;
  imageUrl: string;
}): StoryStartingFrame | undefined {
  const existing = getSlice("storyStartingFrames").find(
    (f) => f.projectId === args.projectId && f.sourceShotId === args.sourceShotId,
  );
  if (existing) return existing;
  return addRaw({ ...args, source: "extracted-from-shot" });
}

export function removeStoryStartingFrame(id: string): StoryStartingFrame | undefined {
  const all = getSlice("storyStartingFrames");
  const found = all.find((f) => f.id === id);
  if (!found) return undefined;
  setSlice("storyStartingFrames", all.filter((f) => f.id !== id));
  return found;
}

// Cascade helper for project deletion.
export function removeStoryStartingFramesByProject(projectId: string): number {
  const all = getSlice("storyStartingFrames");
  const survivors = all.filter((f) => f.projectId !== projectId);
  if (survivors.length === all.length) return 0;
  setSlice("storyStartingFrames", survivors);
  return all.length - survivors.length;
}

export function subscribeStoryStartingFrames(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("story-starting-frames-changed", handler);
  return () => window.removeEventListener("story-starting-frames-changed", handler);
}
