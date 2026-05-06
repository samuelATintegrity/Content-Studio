"use client";

// Client-side trigger for the Premiere zip export. Builds the export
// payload from the current store + shot library, POSTs to
// /api/funny-commercial/export-zip, streams the response back as a
// blob, and triggers a browser download to the user's default download
// folder (typically ~/Downloads on macOS / C:\Users\<u>\Downloads on
// Windows).

import { useBatchStore } from "@/store/batchStore";
import { listFcShots } from "@/lib/funnyCommercialShots";

export async function exportFunnyCommercialZip(): Promise<void> {
  const state = useBatchStore.getState();
  const items = state.fcTimelineItems;
  if (items.length === 0) {
    throw new Error("Add at least one shot to the timeline first.");
  }
  const shots = listFcShots();
  const payload = items.map((item, idx) => {
    const shot = shots.find((s) => s.id === item.shotId);
    if (!shot || !shot.videoUrl) {
      throw new Error(
        `Slot ${idx + 1} references a shot that hasn't been animated yet.`,
      );
    }
    return {
      slotIndex: idx + 1,
      clipUrl: shot.videoUrl,
      // Default 5s when not explicitly trimmed; the worker's render
      // pipeline probes actual durations but the XML needs a number,
      // so we use the trim-or-default convention from the store.
      durationS: item.durationS ?? 5,
      overlayText: item.overlay?.text,
      // We don't pre-render narrations on the client — the export
      // route can only embed pre-existing narration mp3s, so until
      // we add a separate narration-render endpoint, the XML carries
      // overlay text but no narration audio. Premiere users can
      // record narration in-app; the v3 work item is to wire a
      // /narration endpoint that returns an R2-hosted mp3 the export
      // route can fetch.
      narrationUrl: undefined,
    };
  });

  const sequenceName = `Funny Commercial — ${new Date().toLocaleString()}`;

  const res = await fetch("/api/funny-commercial/export-zip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sequenceName, timeline: payload }),
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
  a.download = `funny-commercial-${Date.now()}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so older Safari versions actually start the download.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
