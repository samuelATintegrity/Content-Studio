"use client";

import { useEffect, useState } from "react";
import {
  getStoryProject,
  subscribeStoryProjects,
  validateSequenceShots,
} from "@/lib/storyProjects";
import { exportStoryZip } from "@/lib/storyExport";
import type { StoryProject } from "@/lib/types";

interface Props {
  projectId: string;
}

// Sticky bottom bar: shows sequence length + the "Export Premiere XML"
// CTA. The button is disabled until the sequence has at least one
// shot. Clicking POSTs to /api/story/export-zip and triggers a browser
// download.

export function ExportBar({ projectId }: Props) {
  const [project, setProject] = useState<StoryProject | undefined>(() =>
    getStoryProject(projectId),
  );
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => subscribeStoryProjects(() => setProject(getStoryProject(projectId))),
    [projectId],
  );

  if (!project) return null;

  const ready = project.sequenceItems.length > 0;

  async function exportZip() {
    if (!ready || exporting) return;
    setError(null);

    // Validate before kicking off the network round-trip — gives the
    // user immediate feedback rather than a 400 from the server.
    const validationError = validateSequenceShots(projectId);
    if (validationError) {
      setError(validationError);
      return;
    }

    setExporting(true);
    try {
      await exportStoryZip();
    } catch (e) {
      setError(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 sticky bottom-2 z-20">
      <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur shadow-sm">
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold tracking-tight">Export sequence</span>
          <span className="text-[10px] text-neutral-500">
            {ready
              ? `${project.sequenceItems.length} ${project.sequenceItems.length === 1 ? "shot" : "shots"} in sequence — Premiere XML zip`
              : "Add at least one shot to the sequence to enable export"}
          </span>
        </div>
        <button
          type="button"
          onClick={exportZip}
          disabled={!ready || exporting}
          className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-50"
        >
          {exporting ? "Building zip…" : "Export Premiere XML"}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-500 px-3">{error}</p>}
    </section>
  );
}
