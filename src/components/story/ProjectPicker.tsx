"use client";

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  createStoryProject,
  listStoryProjects,
  removeStoryProject,
  subscribeStoryProjects,
} from "@/lib/storyProjects";
import type { StoryProject } from "@/lib/types";

// First-screen chooser. Two options: Load existing project, or New
// project. Saved projects render as a click-to-load grid when present.
//
// User flow: arrive at story-builder mode → see this → pick → land in
// ProjectHome. Switching projects later is via the "Switch project"
// affordance in ProjectHome, which clears storyActiveProjectId and
// brings them back here.

export function ProjectPicker() {
  const setStoryActiveProjectId = useBatchStore((s) => s.setStoryActiveProjectId);
  const [projects, setProjects] = useState<StoryProject[]>(() => listStoryProjects());
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeStoryProjects(() => setProjects(listStoryProjects())), []);

  function startCreate() {
    setError(null);
    setCreating(true);
    setDraft("");
  }

  function commitCreate() {
    const name = draft.trim();
    if (!name) {
      setError("Give the project a name first.");
      return;
    }
    try {
      const project = createStoryProject(name);
      setStoryActiveProjectId(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project.");
    }
  }

  function cancelCreate() {
    setCreating(false);
    setDraft("");
    setError(null);
  }

  function load(project: StoryProject) {
    setStoryActiveProjectId(project.id);
  }

  function deleteProject(project: StoryProject) {
    if (
      !window.confirm(
        `Delete project "${project.name}"? This also deletes its shots and starting frames. This can't be undone.`,
      )
    ) {
      return;
    }
    removeStoryProject(project.id);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight">Story builder</h2>
        <p className="text-[12px] text-neutral-500 leading-relaxed max-w-xl">
          Build a story one shot at a time. Each project owns its own starting-frame and shot
          libraries. Pick a project to keep going, or start fresh.
        </p>
      </header>

      {/* Two big primary actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          disabled={projects.length === 0 || creating}
          onClick={() => {
            // Scroll to the project list below; on smaller screens it
            // may sit beneath the fold. No-op when there's nothing to
            // load.
            document.getElementById("story-project-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={`flex flex-col items-start gap-1 px-5 py-5 rounded-2xl border text-left transition ${
            projects.length === 0
              ? "border-dashed border-neutral-200 dark:border-neutral-800 text-neutral-400 cursor-not-allowed"
              : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900"
          }`}
        >
          <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
            Load project
          </span>
          <span className="text-[14px] font-semibold tracking-tight">
            {projects.length === 0 ? "No projects yet" : `${projects.length} saved`}
          </span>
          <span className="text-[11px] text-neutral-500 leading-snug">
            Pick up where you left off on a story already in progress.
          </span>
        </button>

        <button
          type="button"
          onClick={startCreate}
          className="flex flex-col items-start gap-1 px-5 py-5 rounded-2xl border-2 border-neutral-900 dark:border-white bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-left hover:bg-neutral-800 dark:hover:bg-neutral-100 transition"
        >
          <span className="text-[11px] uppercase tracking-[0.16em] opacity-80 font-semibold">
            Start new
          </span>
          <span className="text-[14px] font-semibold tracking-tight">+ New project</span>
          <span className="text-[11px] opacity-80 leading-snug">
            Fresh canvas. Name it and start building shots.
          </span>
        </button>
      </div>

      {/* Inline create form. Shows under the buttons when active. */}
      {creating && (
        <div className="flex flex-col gap-2 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
          <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
            Project name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreate();
                if (e.key === "Escape") cancelCreate();
              }}
              autoFocus
              placeholder="e.g. apartment chase"
              className="flex-1 px-3 py-2 rounded-xl text-[13px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
            />
            <button
              type="button"
              onClick={commitCreate}
              disabled={!draft.trim()}
              className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
            >
              Create
            </button>
            <button
              type="button"
              onClick={cancelCreate}
              className="px-3 py-2 rounded-full text-[12px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-[11px] text-red-500">{error}</p>}
        </div>
      )}

      {/* Project list */}
      {projects.length > 0 && (
        <div id="story-project-list" className="flex flex-col gap-3">
          <h3 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
            Saved projects
          </h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {projects.map((p) => (
              <li
                key={p.id}
                className="group flex items-center gap-2 px-3 py-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
              >
                <button
                  type="button"
                  onClick={() => load(p)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-[13px] font-medium truncate">{p.name}</div>
                  <div className="text-[10px] text-neutral-500 truncate">
                    {p.sequenceItems.length} {p.sequenceItems.length === 1 ? "shot" : "shots"} in sequence
                    {" · "}
                    {new Date(p.savedAt).toLocaleDateString()}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => deleteProject(p)}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition text-neutral-400 hover:text-red-500"
                  title="Delete project"
                >
                  <CloseIcon />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
