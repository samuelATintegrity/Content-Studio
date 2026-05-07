"use client";

import { useEffect, useState } from "react";
import {
  listStoryStartingFrames,
  removeStoryStartingFrame,
  subscribeStoryStartingFrames,
} from "@/lib/storyStartingFrames";
import {
  listStoryShots,
  removeStoryShot,
  subscribeStoryShots,
} from "@/lib/storyShots";
import {
  addShotToSequence,
  getStoryProject,
  subscribeStoryProjects,
} from "@/lib/storyProjects";
import type { StoryShot, StoryStartingFrame } from "@/lib/types";

interface Props {
  projectId: string;
}

// Mini library — two-tab card surfacing the project's saved starting
// frames and shots. Sequencing (adding a shot to the export sequence)
// happens on the Shots tab via an inline "Add to sequence" button.
//
// Both tabs subscribe to their slice's change event so they stay in
// sync without parent-driven reloads.

type Tab = "frames" | "shots";

export function MiniLibrary({ projectId }: Props) {
  const [tab, setTab] = useState<Tab>("frames");
  const [frames, setFrames] = useState<StoryStartingFrame[]>(() =>
    listStoryStartingFrames(projectId),
  );
  const [shots, setShots] = useState<StoryShot[]>(() => listStoryShots(projectId));
  const [sequenceShotIds, setSequenceShotIds] = useState<Set<string>>(() => {
    const project = getStoryProject(projectId);
    return new Set(project?.sequenceItems.map((i) => i.shotId) ?? []);
  });

  useEffect(
    () => subscribeStoryStartingFrames(() => setFrames(listStoryStartingFrames(projectId))),
    [projectId],
  );
  useEffect(
    () => subscribeStoryShots(() => setShots(listStoryShots(projectId))),
    [projectId],
  );
  useEffect(
    () =>
      subscribeStoryProjects(() => {
        const project = getStoryProject(projectId);
        setSequenceShotIds(new Set(project?.sequenceItems.map((i) => i.shotId) ?? []));
      }),
    [projectId],
  );

  function deleteFrame(frame: StoryStartingFrame) {
    if (!window.confirm("Delete this starting frame?")) return;
    removeStoryStartingFrame(frame.id);
  }

  function deleteShot(shot: StoryShot) {
    if (!window.confirm("Delete this shot? Removing it also drops it from the sequence.")) return;
    removeStoryShot(shot.id);
    // Project sequence cleanup happens lazily — validateSequenceShots
    // catches dangling references at export time. The Mini Library's
    // count badge updates through the shots subscription.
  }

  function addToSeq(shot: StoryShot) {
    addShotToSequence(projectId, shot.id);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
          Mini library
        </h3>
        <div className="flex gap-1 ml-auto rounded-full bg-neutral-100 dark:bg-neutral-900 p-1">
          <TabPill selected={tab === "frames"} onClick={() => setTab("frames")}>
            Starting frames ({frames.length})
          </TabPill>
          <TabPill selected={tab === "shots"} onClick={() => setTab("shots")}>
            Shots ({shots.length})
          </TabPill>
        </div>
      </div>

      {tab === "frames" && (
        <>
          {frames.length === 0 ? (
            <p className="text-[12px] text-neutral-500 leading-snug py-2">
              No starting frames yet. Upload, generate, or save a shot — saved shots auto-deposit
              their last frame here.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {frames.map((f) => (
                <div
                  key={f.id}
                  className="group relative aspect-[9/16] rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    title={f.prompt ?? f.source}
                  />
                  <span className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 bg-black/65 text-white text-[8px] uppercase tracking-[0.12em] text-center">
                    {f.source === "extracted-from-shot" ? "from shot" : f.source}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteFrame(f)}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/65 text-white opacity-0 group-hover:opacity-100 transition"
                    title="Delete frame"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "shots" && (
        <>
          {shots.length === 0 ? (
            <p className="text-[12px] text-neutral-500 leading-snug py-2">
              No shots yet. Click <span className="font-medium">+ New shot</span> above to build
              the first one.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {shots.map((shot) => {
                const inSeq = sequenceShotIds.has(shot.id);
                return (
                  <div
                    key={shot.id}
                    className="group flex flex-col rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden"
                  >
                    <div className="aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative">
                      <video
                        src={shot.videoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                        onMouseEnter={(e) =>
                          (e.currentTarget as HTMLVideoElement).play().catch(() => {})
                        }
                        onMouseLeave={(e) => {
                          const v = e.currentTarget as HTMLVideoElement;
                          v.pause();
                          v.currentTime = 0;
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => deleteShot(shot)}
                        className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
                        title="Delete shot"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                    <div className="p-2.5 flex flex-col gap-1.5 bg-white dark:bg-neutral-950">
                      <p
                        className="text-[10px] text-neutral-500 leading-snug line-clamp-2"
                        title={shot.animationPrompt}
                      >
                        {shot.animationPrompt || "(no prompt)"}
                      </p>
                      {inSeq ? (
                        <span className="text-[10px] text-emerald-600 font-medium px-2 py-0.5 self-start">
                          ✓ In sequence
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToSeq(shot)}
                          className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 self-start"
                        >
                          Add to sequence
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TabPill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-[0.14em] font-semibold transition ${
        selected
          ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
          : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
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
