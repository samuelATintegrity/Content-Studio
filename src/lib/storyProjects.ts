"use client";

// Story Builder — project CRUD helpers.
//
// A project is the top-level container. It owns its sequence
// arrangement and is the foreign-key target for shots + starting
// frames stored in the global slices. Listing in reverse chronological
// order (most recently saved first) so the project picker surfaces the
// active work first.

import { getSlice, setSlice } from "./libraryStore";
import { useBatchStore } from "@/store/batchStore";
import { listStoryShots, removeStoryShotsByProject } from "./storyShots";
import { removeStoryStartingFramesByProject } from "./storyStartingFrames";
import type { StoryProject, StorySequenceItem } from "./types";

function newProjectId(): string {
  return `story-proj-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function newSlotId(): string {
  return `story-slot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function listStoryProjects(): StoryProject[] {
  return getSlice("storyProjects").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function getStoryProject(id: string): StoryProject | undefined {
  return getSlice("storyProjects").find((p) => p.id === id);
}

// Create a new empty project under the given name. Returns the
// persisted record so the caller can immediately switch the store
// to its id.
export function createStoryProject(name: string): StoryProject {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name cannot be empty");
  const all = getSlice("storyProjects");
  const language = useBatchStore.getState().language;
  const entry: StoryProject = {
    id: newProjectId(),
    name: trimmed,
    savedAt: Date.now(),
    sequenceItems: [],
    language,
  };
  setSlice("storyProjects", [...all, entry]);
  return entry;
}

// Rename a project in place. Bumps savedAt so it floats to the top of
// the list — generally what the user wants after touching it.
export function renameStoryProject(id: string, name: string): StoryProject | undefined {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name cannot be empty");
  const all = getSlice("storyProjects");
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return undefined;
  const next = all.slice();
  next[idx] = { ...next[idx], name: trimmed, savedAt: Date.now() };
  setSlice("storyProjects", next);
  return next[idx];
}

// Replace the sequence on an existing project. Used by the Shot
// Sequence panel to persist reorder operations without spinning a new
// project record. Bumps savedAt.
export function setStoryProjectSequence(
  id: string,
  sequenceItems: StorySequenceItem[],
): StoryProject | undefined {
  const all = getSlice("storyProjects");
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return undefined;
  const next = all.slice();
  next[idx] = { ...next[idx], sequenceItems, savedAt: Date.now() };
  setSlice("storyProjects", next);
  return next[idx];
}

// Append a shot to the end of a project's sequence. No-op if the shot
// is already in the sequence — sequencing the same shot twice would
// produce duplicate clips in the export and confuse the reorder UI.
export function addShotToSequence(projectId: string, shotId: string): StoryProject | undefined {
  const project = getStoryProject(projectId);
  if (!project) return undefined;
  if (project.sequenceItems.some((i) => i.shotId === shotId)) return project;
  const next = [
    ...project.sequenceItems,
    { id: newSlotId(), shotId },
  ];
  return setStoryProjectSequence(projectId, next);
}

export function removeShotFromSequence(
  projectId: string,
  slotId: string,
): StoryProject | undefined {
  const project = getStoryProject(projectId);
  if (!project) return undefined;
  return setStoryProjectSequence(
    projectId,
    project.sequenceItems.filter((i) => i.id !== slotId),
  );
}

// Move a sequence slot to a target index. Indices are clamped to the
// current sequence length; out-of-range moves are no-ops.
export function reorderSequenceSlot(
  projectId: string,
  slotId: string,
  toIndex: number,
): StoryProject | undefined {
  const project = getStoryProject(projectId);
  if (!project) return undefined;
  const fromIndex = project.sequenceItems.findIndex((i) => i.id === slotId);
  if (fromIndex < 0) return project;
  const target = Math.max(0, Math.min(toIndex, project.sequenceItems.length - 1));
  if (fromIndex === target) return project;
  const next = project.sequenceItems.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(target, 0, moved);
  return setStoryProjectSequence(projectId, next);
}

// Delete a project AND every shot + starting frame scoped to it.
// Cascade keeps the libraries from accumulating orphaned records the
// UI never surfaces (and that would still pay R2 storage costs).
export function removeStoryProject(id: string): StoryProject | undefined {
  const all = getSlice("storyProjects");
  const found = all.find((p) => p.id === id);
  if (!found) return undefined;
  setSlice("storyProjects", all.filter((p) => p.id !== id));
  removeStoryShotsByProject(id);
  removeStoryStartingFramesByProject(id);
  // If the user just deleted the active project, drop the active id so
  // the panel returns to the project picker rather than rendering an
  // empty home for a now-missing project.
  const store = useBatchStore.getState();
  if (store.storyActiveProjectId === id) {
    store.setStoryActiveProjectId(null);
  }
  return found;
}

// Walk the sequence and fail fast if any referenced shot is missing.
// Used by the export bar before kicking off a Premiere zip download.
export function validateSequenceShots(projectId: string): string | null {
  const project = getStoryProject(projectId);
  if (!project) return "Project not found.";
  if (project.sequenceItems.length === 0) {
    return "Add at least one shot to the sequence first.";
  }
  const projectShots = listStoryShots(projectId);
  const missing = project.sequenceItems.filter(
    (i) => !projectShots.some((s) => s.id === i.shotId),
  );
  if (missing.length > 0) {
    return `${missing.length} sequence slot${missing.length === 1 ? "" : "s"} reference a shot that's been deleted.`;
  }
  return null;
}

export function subscribeStoryProjects(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("story-projects-changed", handler);
  return () => window.removeEventListener("story-projects-changed", handler);
}
