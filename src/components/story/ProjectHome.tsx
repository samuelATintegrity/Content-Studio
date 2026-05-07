"use client";

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  getStoryProject,
  subscribeStoryProjects,
} from "@/lib/storyProjects";
import { listStoryShots, subscribeStoryShots } from "@/lib/storyShots";
import { MiniLibrary } from "./MiniLibrary";
import { ShotSequence } from "./ShotSequence";
import { ExportBar } from "./ExportBar";
import type { StoryProject, StoryShot } from "@/lib/types";

interface Props {
  projectId: string;
  onStartNewShot: () => void;
  onStartContinue: () => void;
}

// ProjectHome is the workspace view for an active project. It shows:
//   - the project header + Switch project affordance
//   - the two primary actions: New shot, Continue (disabled if no shots yet)
//   - the Mini library (Starting frames + Shots tabs)
//   - the Shot sequence panel
//   - the sticky export bar
//
// The wizard launches happen via callbacks rather than rendering the
// wizards inline so the panel can fully replace the workspace view —
// less visual noise during a focused new-shot flow.

export function ProjectHome({ projectId, onStartNewShot, onStartContinue }: Props) {
  const setStoryActiveProjectId = useBatchStore((s) => s.setStoryActiveProjectId);
  const [project, setProject] = useState<StoryProject | undefined>(() =>
    getStoryProject(projectId),
  );
  const [shots, setShots] = useState<StoryShot[]>(() => listStoryShots(projectId));

  useEffect(
    () => subscribeStoryProjects(() => setProject(getStoryProject(projectId))),
    [projectId],
  );
  useEffect(
    () => subscribeStoryShots(() => setShots(listStoryShots(projectId))),
    [projectId],
  );

  if (!project) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-red-500">Project not found.</p>
        <button
          type="button"
          onClick={() => setStoryActiveProjectId(null)}
          className="self-start text-[11px] underline-offset-2 hover:underline"
        >
          ← Back to project picker
        </button>
      </div>
    );
  }

  const hasShots = shots.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
            Story
          </span>
          <h2 className="text-base font-semibold tracking-tight">{project.name}</h2>
          <span className="text-[11px] text-neutral-500">
            {shots.length} {shots.length === 1 ? "shot" : "shots"} ·{" "}
            {project.sequenceItems.length}{" "}
            {project.sequenceItems.length === 1 ? "in sequence" : "in sequence"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setStoryActiveProjectId(null)}
          className="text-[11px] font-medium px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
        >
          Switch project
        </button>
      </header>

      {/* Primary action row — New shot vs Continue. Continue is
          disabled until at least one shot exists, since there's
          nothing to continue from. */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onStartNewShot}
          className="flex flex-col items-start gap-1 px-5 py-5 rounded-2xl border-2 border-neutral-900 dark:border-white bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-left hover:bg-neutral-800 dark:hover:bg-neutral-100 transition"
        >
          <span className="text-[11px] uppercase tracking-[0.16em] opacity-80 font-semibold">
            Build
          </span>
          <span className="text-[14px] font-semibold tracking-tight">+ New shot</span>
          <span className="text-[11px] opacity-80 leading-snug">
            Upload, generate, or pick a starting frame from this project's library.
          </span>
        </button>
        <button
          type="button"
          onClick={onStartContinue}
          disabled={!hasShots}
          className={`flex flex-col items-start gap-1 px-5 py-5 rounded-2xl border text-left transition ${
            !hasShots
              ? "border-dashed border-neutral-200 dark:border-neutral-800 text-neutral-400 cursor-not-allowed"
              : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          }`}
          title={hasShots ? undefined : "Save a shot first to enable continuing"}
        >
          <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
            Chain
          </span>
          <span className="text-[14px] font-semibold tracking-tight">
            Continue from a shot
          </span>
          <span className="text-[11px] text-neutral-500 leading-snug">
            Pick a saved shot — its last frame becomes the seed for the next one.
          </span>
        </button>
      </section>

      <MiniLibrary projectId={projectId} />

      <ShotSequence projectId={projectId} />

      <ExportBar projectId={projectId} />
    </div>
  );
}
