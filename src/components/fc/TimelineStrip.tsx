"use client";

import { useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import { getFcShot } from "@/lib/funnyCommercialShots";
import type { FcTimelineOverlay } from "@/lib/types";

// TimelineStrip — ordered horizontal strip of timeline slots. Each
// slot:
//   - Shows the shot's first-frame thumbnail.
//   - Click to open the overlay editor.
//   - ◀ ▶ buttons reorder; ✕ removes the slot.
//   - Indicators: 📝 if overlay text present, 🎤 if narration enabled.

export function TimelineStrip() {
  const fcTimelineItems = useBatchStore((s) => s.fcTimelineItems);
  const fcRemoveFromTimeline = useBatchStore((s) => s.fcRemoveFromTimeline);
  const fcReorderTimeline = useBatchStore((s) => s.fcReorderTimeline);
  const fcSetTimelineOverlay = useBatchStore((s) => s.fcSetTimelineOverlay);
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);

  if (fcTimelineItems.length === 0) {
    return (
      <Section title="Timeline">
        <p className="text-[12px] text-neutral-500 leading-snug py-4">
          Add shots from the library above (or compose new ones) to build the ad. Drag-order to taste.
        </p>
      </Section>
    );
  }

  return (
    <Section title={`Timeline (${fcTimelineItems.length} ${fcTimelineItems.length === 1 ? "shot" : "shots"})`}>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {fcTimelineItems.map((slot, idx) => {
          const shot = getFcShot(slot.shotId);
          const hasOverlay = !!slot.overlay?.text.trim();
          const hasNarration = !!slot.overlay?.narrate;
          const editing = editingSlotId === slot.id;
          return (
            <div key={slot.id} className="flex flex-col gap-1 shrink-0 w-32">
              <div className="relative rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
                {shot?.videoUrl ? (
                  <video
                    src={shot.videoUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="w-32 aspect-[9/16] object-cover"
                  />
                ) : shot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shot.imageUrl}
                    alt=""
                    className="w-32 aspect-[9/16] object-cover"
                  />
                ) : (
                  <div className="w-32 aspect-[9/16] flex items-center justify-center text-[10px] text-red-500 px-2 text-center">
                    Missing shot
                  </div>
                )}
                <span className="absolute top-1 left-1 text-[9px] font-semibold bg-black/70 text-white px-1.5 py-0.5 rounded-full tabular-nums">
                  {idx + 1}
                </span>
                {(hasOverlay || hasNarration) && (
                  <span className="absolute bottom-1 left-1 right-1 text-[9px] bg-black/65 text-white px-1.5 py-0.5 rounded-full text-center truncate">
                    {hasOverlay && "📝 "}
                    {hasNarration && "🎤 "}
                    {slot.overlay?.text.slice(0, 18) ?? ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => fcReorderTimeline(slot.id, idx - 1)}
                  disabled={idx === 0}
                  className="flex-1 text-[11px] py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-900 disabled:opacity-30"
                  title="Move left"
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => setEditingSlotId(editing ? null : slot.id)}
                  className={`flex-1 text-[10px] py-1 rounded-md transition ${
                    editing
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  }`}
                  title="Edit overlay"
                >
                  Text
                </button>
                <button
                  type="button"
                  onClick={() => fcReorderTimeline(slot.id, idx + 1)}
                  disabled={idx === fcTimelineItems.length - 1}
                  className="flex-1 text-[11px] py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-900 disabled:opacity-30"
                  title="Move right"
                >
                  ▶
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove slot ${idx + 1} from the timeline?`)) {
                      fcRemoveFromTimeline(slot.id);
                      if (editingSlotId === slot.id) setEditingSlotId(null);
                    }
                  }}
                  className="text-[11px] px-1.5 py-1 rounded-md text-neutral-500 hover:text-red-500"
                  title="Remove from timeline"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {editingSlotId && (
        <OverlayEditor
          slotId={editingSlotId}
          initialOverlay={
            fcTimelineItems.find((s) => s.id === editingSlotId)?.overlay
          }
          onSave={(overlay) => {
            fcSetTimelineOverlay(editingSlotId, overlay);
            setEditingSlotId(null);
          }}
          onClose={() => setEditingSlotId(null)}
        />
      )}
    </Section>
  );
}

function OverlayEditor({
  initialOverlay,
  onSave,
  onClose,
}: {
  slotId: string;
  initialOverlay?: FcTimelineOverlay;
  onSave: (overlay: FcTimelineOverlay | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialOverlay?.text ?? "");
  const [narrate, setNarrate] = useState(initialOverlay?.narrate ?? false);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
      <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
        Overlay text (renders centered, burned-in)
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="e.g. Time to buy your own place?"
        className="w-full px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
      />
      <label className="flex items-center gap-2 text-[11px] text-neutral-600 dark:text-neutral-400 cursor-pointer">
        <input
          type="checkbox"
          checked={narrate}
          onChange={(e) => setNarrate(e.target.checked)}
          className="accent-neutral-900 dark:accent-white"
        />
        Narrate this text via ElevenLabs (uses the active language voice)
      </label>
      <div className="flex justify-end gap-2 mt-1">
        {initialOverlay && (
          <button
            type="button"
            onClick={() => onSave(null)}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
          >
            Remove overlay
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 rounded-full text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const trimmed = text.trim();
            if (!trimmed) {
              onSave(null);
            } else {
              onSave({ text: trimmed, narrate });
            }
          }}
          className="px-4 py-1.5 rounded-full text-[11px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
