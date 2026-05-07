"use client";

// Story Builder — shot library helpers.
//
// Shots are project-scoped via `projectId`. The global `storyShots`
// slice holds every shot across every project; helpers here filter
// by projectId so the UI only ever sees the active project's shots.
//
// A shot is a saved, animated beat. The new-shot wizard only commits
// to addStoryShot AFTER a successful animation — there are no "still-
// only" or "queued" intermediate states stored in the library. That
// keeps the list a clean view of work the user has actually approved.

import { getSlice, setSlice } from "./libraryStore";
import { addStartingFrameFromShot } from "./storyStartingFrames";
import type { StoryShot } from "./types";

function newShotId(): string {
  return `story-shot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// All shots for a project, newest first.
export function listStoryShots(projectId: string): StoryShot[] {
  return getSlice("storyShots")
    .filter((s) => s.projectId === projectId)
    .slice()
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function getStoryShot(id: string): StoryShot | undefined {
  return getSlice("storyShots").find((s) => s.id === id);
}

// Persist a freshly-animated shot. The caller is responsible for ensuring
// the animation actually returned a videoUrl — there's no "draft" path
// in the new flow. When `lastFrameImageUrl` is present we also auto-
// register a StoryStartingFrame so the user can chain future shots from
// any prior beat without juggling separate panels.
export function addStoryShot(input: {
  projectId: string;
  startingFrameImageUrl: string;
  animationPrompt: string;
  videoUrl: string;
  lastFrameImageUrl?: string;
  title?: string;
}): StoryShot {
  const all = getSlice("storyShots");
  const entry: StoryShot = {
    id: newShotId(),
    projectId: input.projectId,
    startingFrameImageUrl: input.startingFrameImageUrl,
    animationPrompt: input.animationPrompt,
    videoUrl: input.videoUrl,
    lastFrameImageUrl: input.lastFrameImageUrl,
    title: input.title,
    savedAt: Date.now(),
  };
  setSlice("storyShots", [...all, entry]);
  if (entry.lastFrameImageUrl) {
    addStartingFrameFromShot({
      projectId: entry.projectId,
      sourceShotId: entry.id,
      imageUrl: entry.lastFrameImageUrl,
    });
  }
  return entry;
}

// Patch a shot in place. Used for renaming + late-arriving last-frame
// extraction (when the original extraction failed during animate but a
// retry succeeds).
export function updateStoryShot(id: string, patch: Partial<StoryShot>): StoryShot | undefined {
  const all = getSlice("storyShots");
  const idx = all.findIndex((s) => s.id === id);
  if (idx < 0) return undefined;
  const next = all.slice();
  next[idx] = { ...next[idx], ...patch };
  setSlice("storyShots", next);
  return next[idx];
}

export function removeStoryShot(id: string): StoryShot | undefined {
  const all = getSlice("storyShots");
  const found = all.find((s) => s.id === id);
  if (!found) return undefined;
  setSlice("storyShots", all.filter((s) => s.id !== id));
  return found;
}

// Cascade helper for project deletion. Drops every shot tied to the
// given project. Starting frames are cascaded separately.
export function removeStoryShotsByProject(projectId: string): number {
  const all = getSlice("storyShots");
  const survivors = all.filter((s) => s.projectId !== projectId);
  if (survivors.length === all.length) return 0;
  setSlice("storyShots", survivors);
  return all.length - survivors.length;
}

export function subscribeStoryShots(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("story-shots-changed", handler);
  return () => window.removeEventListener("story-shots-changed", handler);
}
