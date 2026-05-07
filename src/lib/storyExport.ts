"use client";

// Client-side trigger for the Premiere zip export. Builds the export
// payload from the active project's sequence + shot library, POSTs to
// /api/story/export-zip, streams the response as a blob, and triggers
// a browser download.
//
// No narration, no overlay text — Story Builder v1 only sequences raw
// clips. The zip contains just timeline.xml + clips/.

import { useBatchStore } from "@/store/batchStore";
import { getStoryProject, validateSequenceShots } from "./storyProjects";
import { listStoryShots } from "./storyShots";

export async function exportStoryZip(): Promise<void> {
  const state = useBatchStore.getState();
  const projectId = state.storyActiveProjectId;
  if (!projectId) {
    throw new Error("No project selected.");
  }
  const project = getStoryProject(projectId);
  if (!project) {
    throw new Error("Active project not found.");
  }

  const validationError = validateSequenceShots(projectId);
  if (validationError) throw new Error(validationError);

  const shots = listStoryShots(projectId);
  const payload = project.sequenceItems.map((slot, idx) => {
    const shot = shots.find((s) => s.id === slot.shotId);
    if (!shot) {
      // Shouldn't happen — validateSequenceShots already checked. Belt-
      // and-suspenders so a race condition doesn't surface as a
      // confusing 400 from the server.
      throw new Error(`Slot ${idx + 1} references a missing shot.`);
    }
    return {
      slotIndex: idx + 1,
      clipUrl: shot.videoUrl,
      // Kling clips are 5s, Veo clips were 6s. Premiere reads the
      // actual file length when it imports — durationS is just a hint
      // for the XML. Default 5s matches the current Kling-first flow.
      durationS: 5,
    };
  });

  const sequenceName = `${project.name} — ${new Date().toLocaleString()}`;

  const res = await fetch("/api/story/export-zip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sequenceName,
      timeline: payload,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text;
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // leave as-is
    }
    throw new Error(`export failed: ${detail || res.status}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Replace illegal chars in the filename so Windows / macOS / Linux
  // all accept it. Allow letters, numbers, dash, underscore, dot.
  const safeName = project.name.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 50);
  a.download = `${safeName || "story"}-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
