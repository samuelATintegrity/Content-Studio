"use client";

import { useEffect, useState } from "react";
import {
  getStoryProject,
  removeShotFromSequence,
  reorderSequenceSlot,
  subscribeStoryProjects,
} from "@/lib/storyProjects";
import { listStoryShots, subscribeStoryShots } from "@/lib/storyShots";
import type { StoryProject, StoryShot, StorySequenceItem } from "@/lib/types";

interface Props {
  projectId: string;
}

// Vertical strip of sequence slots. Each slot:
//   - shows the shot's video thumbnail (hover plays it)
//   - ◀ ▶ buttons reorder
//   - ✕ removes from the sequence (the underlying shot stays in the
//     library; only the sequence slot drops)
//
// v1 ships ◀ ▶ instead of HTML5 drag-and-drop; the plan flagged DnD as a
// follow-up.

export function ShotSequence({ projectId }: Props) {
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

  if (!project) return null;

  const items = project.sequenceItems;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
        Shot sequence ({items.length})
      </h3>
      {items.length === 0 ? (
        <p className="text-[12px] text-neutral-500 leading-snug py-2">
          No shots in the sequence yet. Add saved shots from the Mini library above to set the
          export order.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {items.map((slot, idx) => (
            <SequenceSlot
              key={slot.id}
              slot={slot}
              index={idx}
              total={items.length}
              shot={shots.find((s) => s.id === slot.shotId)}
              onMoveLeft={() => reorderSequenceSlot(projectId, slot.id, idx - 1)}
              onMoveRight={() => reorderSequenceSlot(projectId, slot.id, idx + 1)}
              onRemove={() => {
                if (window.confirm(`Remove slot ${idx + 1} from the sequence?`)) {
                  removeShotFromSequence(projectId, slot.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SequenceSlot({
  slot,
  index,
  total,
  shot,
  onMoveLeft,
  onMoveRight,
  onRemove,
}: {
  slot: StorySequenceItem;
  index: number;
  total: number;
  shot: StoryShot | undefined;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 shrink-0 w-32">
      <div className="relative rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900">
        {shot ? (
          <video
            src={shot.videoUrl}
            muted
            playsInline
            preload="metadata"
            className="w-32 aspect-[9/16] object-cover"
            onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : (
          <div className="w-32 aspect-[9/16] flex items-center justify-center text-[10px] text-red-500 px-2 text-center">
            Missing shot
          </div>
        )}
        <span className="absolute top-1 left-1 text-[9px] font-semibold bg-black/70 text-white px-1.5 py-0.5 rounded-full tabular-nums">
          {index + 1}
        </span>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onMoveLeft}
          disabled={index === 0}
          className="flex-1 text-[11px] py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-900 disabled:opacity-30"
          title="Move left"
        >
          ◀
        </button>
        <button
          type="button"
          onClick={onMoveRight}
          disabled={index === total - 1}
          className="flex-1 text-[11px] py-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-900 disabled:opacity-30"
          title="Move right"
        >
          ▶
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-[11px] px-1.5 py-1 rounded-md text-neutral-500 hover:text-red-500"
          title="Remove from sequence"
        >
          ✕
        </button>
      </div>
      {/* slot.id rendered for visual debugging when something feels off */}
      <span className="sr-only">{slot.id}</span>
    </div>
  );
}
