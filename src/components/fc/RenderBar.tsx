"use client";

import { useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import { generateFunnyCommercialBatch } from "@/lib/generateFunnyCommercial";
import { exportFunnyCommercialZip } from "@/lib/funnyCommercialExport";

// RenderBar — sits at the bottom of the panel. Two outputs:
//   - Render mp4: dispatch the worker render; result lands in the
//     existing VideoCard grid via the VideoPost machinery.
//   - Export Premiere zip: server bundles XML + clips + narrations
//     into a zip; browser downloads it.

export function RenderBar() {
  const fcTimelineItems = useBatchStore((s) => s.fcTimelineItems);
  const loading = useBatchStore((s) => s.loading);
  const ready = fcTimelineItems.length > 0;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportZip() {
    if (!ready || exporting) return;
    setExportError(null);
    setExporting(true);
    try {
      await exportFunnyCommercialZip();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 sticky bottom-2 z-20">
      <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur shadow-sm">
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold tracking-tight">Render commercial</span>
          <span className="text-[10px] text-neutral-500">
            {ready
              ? `${fcTimelineItems.length} ${fcTimelineItems.length === 1 ? "shot" : "shots"} on timeline`
              : "Add at least one shot to enable rendering"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportZip}
            disabled={!ready || loading || exporting}
            className="px-4 py-2 rounded-full text-[12px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
          >
            {exporting ? "Building zip…" : "Export Premiere zip"}
          </button>
          <button
            type="button"
            onClick={() => generateFunnyCommercialBatch()}
            disabled={!ready || loading}
            className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
          >
            {loading ? "Starting…" : "Render mp4"}
          </button>
        </div>
      </div>
      {exportError && (
        <p className="text-[11px] text-red-500 px-3">{exportError}</p>
      )}
    </section>
  );
}
