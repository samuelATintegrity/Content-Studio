"use client";

import { useEffect, useRef, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  addFcShot,
  listFcShots,
  removeFcShot,
  subscribeFcShots,
  updateFcShot,
} from "@/lib/funnyCommercialShots";
import {
  fcAnimateShot,
  fcExtractLastFrame,
  fcUploadShotVideo,
} from "@/lib/funnyCommercial";
import type { FcShot, FcShotKind } from "@/lib/types";

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
  const fcSelectedActorId = useBatchStore((s) => s.fcSelectedActorId);
  const [shots, setShots] = useState<FcShot[]>(() => listFcShots());
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadKind, setUploadKind] = useState<FcShotKind>("actor");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeFcShots(() => setShots(listFcShots())), []);

  async function onUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { cachedUrl, filename } = await fcUploadShotVideo(file);
      // Add a shot record. imageUrl falls back to videoUrl since the
      // browser shows the video element's poster automatically; we
      // don't have a frame extractor for arbitrary uploads (yet).
      const shot = addFcShot({
        kind: uploadKind,
        actorId: uploadKind === "actor" ? fcSelectedActorId ?? undefined : undefined,
        imagePrompt: filename,
        imageUrl: cachedUrl,
        videoUrl: cachedUrl,
        animationPrompt: "(uploaded clip)",
      });
      // Best-effort: extract the last frame so the upload can serve
      // as a continuity seed. Failure is non-fatal — the clip still
      // works as a regular timeline shot, just not pinnable.
      try {
        const { frameUrl } = await fcExtractLastFrame(cachedUrl);
        updateFcShot(shot.id, { lastFrameImageUrl: frameUrl });
      } catch (frameErr) {
        console.warn("[fc] last-frame extract on upload failed:", frameErr);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  function toggleSeed(shot: FcShot) {
    if (fcContinuitySourceShotId === shot.id) {
      setFcContinuitySourceShotId(null);
    } else {
      setFcContinuitySourceShotId(shot.id);
    }
  }

  // Empty state: still show the upload card so the user can seed
  // the library with their own clips before composing anything.
  const hasShots = shots.length > 0;

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
    <Section title={`Shots library${hasShots ? ` (${shots.length})` : ""}`}>
      {error && <p className="text-[11px] text-red-500">{error}</p>}
      {!hasShots && (
        <p className="text-[12px] text-neutral-500 leading-snug py-2">
          Compose your first shot above, or upload an existing mp4 below.
        </p>
      )}
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
        {/* Upload tile: same dimensions as a shot card, dashed
            outline so it reads as an action affordance. Tap → opens
            file picker → uploads to R2 via /api/video/upload-clip
            → adds an FcShot record + extracts last frame for
            continuity seeding. */}
        <div className="flex flex-col rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 hover:border-neutral-500 transition overflow-hidden">
          <button
            type="button"
            onClick={() => !uploading && uploadInputRef.current?.click()}
            disabled={uploading}
            className="aspect-[9/16] bg-neutral-50 dark:bg-neutral-900 flex flex-col items-center justify-center gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span className="text-[11px] font-medium">
              {uploading ? "Uploading…" : "Upload mp4"}
            </span>
            <span className="text-[10px] text-neutral-400 px-3 text-center leading-tight">
              {uploading
                ? "Mirroring to R2…"
                : "Drop a finished clip straight into the library"}
            </span>
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            accept="video/mp4,video/*"
            onChange={onUploadFile}
            className="hidden"
          />
          <div className="p-2 flex items-center justify-center gap-1 bg-white dark:bg-neutral-950">
            <span className="text-[10px] uppercase tracking-[0.12em] text-neutral-500">label as:</span>
            <button
              type="button"
              onClick={() => setUploadKind("actor")}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                uploadKind === "actor"
                  ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white"
                  : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
            >
              Actor
            </button>
            <button
              type="button"
              onClick={() => setUploadKind("crazy")}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition ${
                uploadKind === "crazy"
                  ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white"
                  : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
            >
              Crazy
            </button>
          </div>
        </div>
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
