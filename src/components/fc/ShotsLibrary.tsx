"use client";

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  listFcShots,
  removeFcShot,
  subscribeFcShots,
  updateFcShot,
} from "@/lib/funnyCommercialShots";
import { fcAnimateShot } from "@/lib/funnyCommercial";
import type { FcShot } from "@/lib/types";

// ShotsLibrary — every shot the user has composed, animated or not.
// Each card lets the user:
//   - re-animate with a different animation prompt (without
//     re-spending Nano on the still),
//   - add the shot to the timeline (or remove if it's already there),
//   - delete the shot entirely.

export function ShotsLibrary() {
  const fcTimelineItems = useBatchStore((s) => s.fcTimelineItems);
  const fcAddToTimeline = useBatchStore((s) => s.fcAddToTimeline);
  const fcContinuitySourceShotId = useBatchStore((s) => s.fcContinuitySourceShotId);
  const setFcContinuitySourceShotId = useBatchStore((s) => s.setFcContinuitySourceShotId);
  const [shots, setShots] = useState<FcShot[]>(() => listFcShots());
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFcShots(() => setShots(listFcShots())), []);

  function toggleSeed(shot: FcShot) {
    if (fcContinuitySourceShotId === shot.id) {
      setFcContinuitySourceShotId(null);
    } else {
      setFcContinuitySourceShotId(shot.id);
    }
  }

  if (shots.length === 0) {
    return (
      <Section title="Shots library">
        <p className="text-[12px] text-neutral-500 leading-snug py-4">
          Compose your first shot above. As you generate them they show up here, ready to drop on the timeline.
        </p>
      </Section>
    );
  }

  async function reanimate(shot: FcShot, newPrompt?: string) {
    if (animatingId) return;
    const animationPrompt = (newPrompt ?? shot.animationPrompt).trim();
    if (!animationPrompt) {
      setError("Animation prompt is empty.");
      return;
    }
    setError(null);
    setAnimatingId(shot.id);
    try {
      const { videoUrl, lastFrameImageUrl } = await fcAnimateShot({
        imageUrl: shot.imageUrl,
        animationPrompt,
      });
      updateFcShot(shot.id, { videoUrl, lastFrameImageUrl, animationPrompt });
    } catch (e) {
      setError(e instanceof Error ? e.message : "animate failed");
    } finally {
      setAnimatingId(null);
    }
  }

  function deleteShot(shot: FcShot) {
    if (!window.confirm("Delete this shot?")) return;
    removeFcShot(shot.id);
  }

  return (
    <Section title={`Shots library (${shots.length})`}>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {shots.map((shot) => {
          const inTimeline = fcTimelineItems.some((i) => i.shotId === shot.id);
          const isContinuitySeed = fcContinuitySourceShotId === shot.id;
          return (
            <ShotCard
              key={shot.id}
              shot={shot}
              animating={animatingId === shot.id}
              onReanimate={(p) => reanimate(shot, p)}
              onAdd={() => fcAddToTimeline(shot.id)}
              onDelete={() => deleteShot(shot)}
              onToggleSeed={() => toggleSeed(shot)}
              inTimeline={inTimeline}
              isContinuitySeed={isContinuitySeed}
            />
          );
        })}
      </div>
    </Section>
  );
}

function ShotCard({
  shot,
  animating,
  onReanimate,
  onAdd,
  onDelete,
  onToggleSeed,
  inTimeline,
  isContinuitySeed,
}: {
  shot: FcShot;
  animating: boolean;
  onReanimate: (newPrompt?: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  onToggleSeed: () => void;
  inTimeline: boolean;
  isContinuitySeed: boolean;
}) {
  const [animDraft, setAnimDraft] = useState(shot.animationPrompt);
  const [editing, setEditing] = useState(false);
  const seedable = !!shot.videoUrl && !!shot.lastFrameImageUrl;

  return (
    <div
      className={`group flex flex-col rounded-2xl border transition overflow-hidden ${
        isContinuitySeed
          ? "border-emerald-500 ring-2 ring-emerald-500/60"
          : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
      }`}
    >
      <div className="aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative">
        {shot.videoUrl ? (
          <video
            src={shot.videoUrl}
            muted
            playsInline
            preload="metadata"
            className="w-full h-full object-cover"
            onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
            onMouseLeave={(e) => {
              const v = e.currentTarget as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.imageUrl} alt="" className="w-full h-full object-cover" />
        )}
        <span className="absolute top-1.5 left-1.5 text-[9px] uppercase tracking-[0.12em] text-white bg-black/65 px-2 py-0.5 rounded-full">
          {shot.kind}
        </span>
        {!shot.videoUrl && !isContinuitySeed && (
          <span className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-[0.12em] text-white bg-amber-700/85 px-2 py-0.5 rounded-full">
            still only
          </span>
        )}
        {isContinuitySeed && (
          <span className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-[0.12em] text-white bg-emerald-600 px-2 py-0.5 rounded-full font-semibold">
            seed →
          </span>
        )}
        <button
          type="button"
          onClick={onDelete}
          className="absolute bottom-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
          title="Delete shot"
        >
          <CloseIcon />
        </button>
      </div>
      <div className="p-2.5 flex flex-col gap-1.5 bg-white dark:bg-neutral-950">
        <p className="text-[10px] text-neutral-500 leading-snug line-clamp-2" title={shot.imagePrompt}>
          {shot.imagePrompt}
        </p>
        {editing ? (
          <textarea
            value={animDraft}
            onChange={(e) => setAnimDraft(e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 rounded-xl text-[10px] leading-snug border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
          />
        ) : null}
        <div className="flex flex-wrap gap-1.5 mt-1">
          {!shot.videoUrl ? (
            <button
              type="button"
              onClick={() => onReanimate()}
              disabled={animating}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 disabled:opacity-50"
            >
              {animating ? "Animating…" : "Animate"}
            </button>
          ) : inTimeline ? (
            <span className="text-[10px] text-emerald-600 font-medium px-2 py-0.5 self-center">
              On timeline
            </span>
          ) : (
            <button
              type="button"
              onClick={onAdd}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
            >
              Add to timeline
            </button>
          )}
          {shot.videoUrl && (
            <button
              type="button"
              onClick={() => {
                if (editing) {
                  onReanimate(animDraft);
                  setEditing(false);
                } else {
                  setEditing(true);
                }
              }}
              disabled={animating}
              className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
            >
              {animating ? "…" : editing ? "Apply re-animate" : "Re-animate"}
            </button>
          )}
          {seedable && (
            <button
              type="button"
              onClick={onToggleSeed}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full border transition ${
                isContinuitySeed
                  ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
                  : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
              title={
                isContinuitySeed
                  ? "Pinned as continuity seed for the next shot. Click to unpin."
                  : "Pin this shot's last frame as the seed for the next continuity shot."
              }
            >
              {isContinuitySeed ? "✓ Seed pinned" : "Pin as seed"}
            </button>
          )}
        </div>
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

function CloseIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
