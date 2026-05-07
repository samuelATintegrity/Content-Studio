"use client";

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  listFcProjects,
  loadFcProject,
  removeFcProject,
  saveFcProject,
  subscribeFcProjects,
  updateFcProject,
} from "@/lib/funnyCommercialProjects";
import type { FcProject } from "@/lib/types";

// Saved Projects section — a collapsible folder at the top of the
// FunnyCommercialPanel. Click the header to expand/collapse.
//
// Inside:
//   - List of saved projects with Load + Delete + Update buttons.
//   - "Save current as…" inline form (name input + Save button).
//
// A project is just a snapshot of the per-batch FC state (actor pick,
// timeline arrangement, continuity pin, render target, language). The
// shared shot/actor/location libraries persist separately, so loading
// a project doesn't blow away your asset library — it just restores
// the timeline arrangement on top of whatever assets are currently
// available.

export function FcProjectsSection() {
  const fcTimelineItems = useBatchStore((s) => s.fcTimelineItems);
  const fcSelectedActorId = useBatchStore((s) => s.fcSelectedActorId);
  const [projects, setProjects] = useState<FcProject[]>(() => listFcProjects());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFcProjects(() => setProjects(listFcProjects())), []);

  const hasWork = fcTimelineItems.length > 0 || fcSelectedActorId !== null;
  const count = projects.length;

  function save() {
    const name = draft.trim();
    if (!name) {
      setError("Give the project a name first.");
      return;
    }
    if (!hasWork) {
      setError("Nothing to save yet — pick an actor or add a shot to the timeline.");
      return;
    }
    setError(null);
    saveFcProject(name);
    setDraft("");
  }

  function update(project: FcProject) {
    if (!hasWork) {
      setError("Nothing to update with — pick an actor or add a shot first.");
      return;
    }
    if (!window.confirm(`Overwrite "${project.name}" with the current state?`)) return;
    setError(null);
    updateFcProject(project.id);
  }

  function load(project: FcProject) {
    if (
      hasWork &&
      !window.confirm(
        `Load "${project.name}"? This replaces the current actor + timeline. Save your current state first if you want to keep it.`,
      )
    ) {
      return;
    }
    setError(null);
    const ok = loadFcProject(project.id);
    if (!ok) setError("Project not found — was it deleted?");
  }

  function deleteProject(project: FcProject) {
    if (!window.confirm(`Delete project "${project.name}"?`)) return;
    removeFcProject(project.id);
  }

  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
      >
        <span className="flex items-center gap-2">
          <ChevronIcon open={open} />
          <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
            Saved projects
          </span>
          <span className="text-[11px] text-neutral-500 tabular-nums">
            {count === 0 ? "none" : `${count}`}
          </span>
        </span>
        <span className="text-[10px] text-neutral-400">
          {open ? "" : "click to open"}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {/* Save form */}
          <div className="flex flex-col gap-2 p-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
              Save current as…
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                placeholder="e.g. apartment chase v2"
                className="flex-1 px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
              />
              <button
                type="button"
                onClick={save}
                disabled={!draft.trim()}
                className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
              >
                Save
              </button>
            </div>
            <p className="text-[10px] text-neutral-500 leading-snug">
              Saves the current actor pick, timeline order, continuity pin, and language. Shot library + actor library persist separately and stay shared across all projects.
            </p>
          </div>

          {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}

          {/* Project list */}
          {projects.length === 0 ? (
            <p className="text-[12px] text-neutral-500 leading-snug py-2 text-center">
              No saved projects yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="group flex items-center gap-2 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-neutral-500 truncate">
                      {p.timelineItems.length} {p.timelineItems.length === 1 ? "shot" : "shots"}
                      {" · "}
                      {new Date(p.savedAt).toLocaleDateString()}
                      {" "}
                      {new Date(p.savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => load(p)}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900"
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    onClick={() => update(p)}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    title="Overwrite this project with the current state"
                  >
                    Update
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteProject(p)}
                    className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition text-neutral-400 hover:text-red-500 ml-1"
                    title="Delete project"
                  >
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-neutral-500 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
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
