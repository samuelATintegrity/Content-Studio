"use client";

// Funny Commercial v2 — saved-project helpers.
//
// A "project" snapshots the per-batch FC state (which actor is picked,
// the timeline arrangement, the continuity pin, the render target,
// and the active language). The shared library data — actors,
// locations, shot library — lives separately and is intentionally NOT
// part of a project, since it's reusable across many ads. Loading a
// project restores the timeline arrangement; if a referenced shot has
// since been deleted the slot will surface as "Missing shot" in the
// timeline strip (existing behavior).

import { getSlice, setSlice } from "./libraryStore";
import { useBatchStore } from "@/store/batchStore";
import type { FcProject } from "./types";

export function listFcProjects(): FcProject[] {
  return getSlice("fcProjects").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function getFcProject(id: string): FcProject | undefined {
  return getSlice("fcProjects").find((p) => p.id === id);
}

// Snapshot the current Funny Commercial batch state under a name.
// Always creates a new entry — caller should ask the user whether to
// rename / replace if collisions matter (we don't enforce uniqueness).
export function saveFcProject(name: string): FcProject {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name cannot be empty");
  const state = useBatchStore.getState();
  const all = getSlice("fcProjects");
  const entry: FcProject = {
    id: `fc-proj-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: trimmed,
    savedAt: Date.now(),
    selectedActorId: state.fcSelectedActorId,
    timelineItems: state.fcTimelineItems,
    continuitySourceShotId: state.fcContinuitySourceShotId,
    renderTarget: state.fcRenderTarget,
    language: state.language,
  };
  setSlice("fcProjects", [...all, entry]);
  return entry;
}

// Overwrite an existing project with current batch state. Useful for
// "save my edits" flows that reuse the original name.
export function updateFcProject(id: string): FcProject | undefined {
  const all = getSlice("fcProjects");
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return undefined;
  const state = useBatchStore.getState();
  const next = all.slice();
  next[idx] = {
    ...next[idx],
    savedAt: Date.now(),
    selectedActorId: state.fcSelectedActorId,
    timelineItems: state.fcTimelineItems,
    continuitySourceShotId: state.fcContinuitySourceShotId,
    renderTarget: state.fcRenderTarget,
    language: state.language,
  };
  setSlice("fcProjects", next);
  return next[idx];
}

// Apply a saved project to the current batch state.
export function loadFcProject(id: string): boolean {
  const project = getFcProject(id);
  if (!project) return false;
  const store = useBatchStore.getState();
  // Switch language first so any downstream reactivity (e.g. voice
  // resolution) sees the right value when the timeline lands.
  if (project.language !== store.language) {
    store.setLanguage(project.language);
  }
  store.setFcSelectedActorId(project.selectedActorId);
  store.setFcTimelineItems(project.timelineItems);
  store.setFcContinuitySourceShotId(project.continuitySourceShotId);
  store.setFcRenderTarget(project.renderTarget);
  return true;
}

export function removeFcProject(id: string): FcProject | undefined {
  const all = getSlice("fcProjects");
  const found = all.find((p) => p.id === id);
  if (!found) return undefined;
  setSlice("fcProjects", all.filter((p) => p.id !== id));
  return found;
}

export function subscribeFcProjects(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("fc-projects-changed", handler);
  return () => window.removeEventListener("fc-projects-changed", handler);
}
