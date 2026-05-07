"use client";

import { useEffect, useState } from "react";
import {
  storyAnimateShot,
  storyWriteAnimationPrompt,
} from "@/lib/storyBuilder";
import {
  addStoryShot,
  listStoryShots,
  subscribeStoryShots,
} from "@/lib/storyShots";
import type { StoryShot } from "@/lib/types";

interface Props {
  projectId: string;
  onClose: () => void;
}

// Continue-shot wizard:
//   step 1: pick source shot (hover-preview)
//   step 2: animation prompt → animate (uses source shot's lastFrame as seed)
//   step 3: review animation → save | reprompt
//
// Mirrors the new-shot flow but with the first-frame source pinned to
// a prior shot. The seed image we hand to Kling is the source shot's
// lastFrameImageUrl. If the source shot doesn't have a last-frame
// (extraction failed during its original animate), the wizard surfaces
// that and bounces the user back to picker.

type Phase = "pick-shot" | "frame-ready" | "animating" | "review";

export function ContinueShotWizard({ projectId, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("pick-shot");
  const [busy, setBusy] = useState<"anim-prompt" | "animate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [shots, setShots] = useState<StoryShot[]>(() => listStoryShots(projectId));
  const [sourceShot, setSourceShot] = useState<StoryShot | null>(null);

  const [animationPrompt, setAnimationPrompt] = useState("");
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultLastFrameUrl, setResultLastFrameUrl] = useState<string | undefined>(undefined);

  useEffect(
    () => subscribeStoryShots(() => setShots(listStoryShots(projectId))),
    [projectId],
  );

  function pickShot(shot: StoryShot) {
    if (!shot.lastFrameImageUrl) {
      setError(
        "This shot doesn't have a usable last frame (extraction failed). Pick a different shot or save a fresh one with a successful extraction first.",
      );
      return;
    }
    setError(null);
    setSourceShot(shot);
    // Pre-fill the animation prompt with the prior shot's prompt so the
    // user has a starting point. Lots of stories keep the same camera
    // direction beat-to-beat, so this is more often right than empty.
    setAnimationPrompt(shot.animationPrompt);
    setPhase("frame-ready");
  }

  async function writeAnimWithAi() {
    if (busy || !sourceShot) return;
    setError(null);
    setBusy("anim-prompt");
    try {
      const { animationPrompt: ap } = await storyWriteAnimationPrompt({
        imagePrompt: sourceShot.animationPrompt,
      });
      setAnimationPrompt(ap);
    } catch (err) {
      console.warn("[story] animation-prompt write failed:", err);
      setError("Couldn't reach Claude. Type the prompt yourself.");
    } finally {
      setBusy(null);
    }
  }

  async function animate() {
    if (busy || !sourceShot?.lastFrameImageUrl) return;
    if (!animationPrompt.trim()) {
      setError("Animation prompt cannot be empty.");
      return;
    }
    setError(null);
    setBusy("animate");
    setPhase("animating");
    try {
      const { videoUrl, lastFrameImageUrl } = await storyAnimateShot({
        imageUrl: sourceShot.lastFrameImageUrl,
        animationPrompt: animationPrompt.trim(),
      });
      setResultVideoUrl(videoUrl);
      setResultLastFrameUrl(lastFrameImageUrl);
      setPhase("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "animate failed");
      setPhase("frame-ready");
    } finally {
      setBusy(null);
    }
  }

  function saveShot() {
    if (!sourceShot?.lastFrameImageUrl || !resultVideoUrl) return;
    addStoryShot({
      projectId,
      startingFrameImageUrl: sourceShot.lastFrameImageUrl,
      animationPrompt: animationPrompt.trim(),
      videoUrl: resultVideoUrl,
      lastFrameImageUrl: resultLastFrameUrl,
    });
    onClose();
  }

  function reprompt() {
    setResultVideoUrl(null);
    setResultLastFrameUrl(undefined);
    setPhase("frame-ready");
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
            Continue from a shot
          </span>
          <h2 className="text-base font-semibold tracking-tight">
            {phase === "pick-shot"
              ? "Step 1: Pick the source shot"
              : phase === "frame-ready" || phase === "animating"
                ? "Step 2: Animate"
                : "Step 3: Review"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] font-medium px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
        >
          Cancel
        </button>
      </header>

      {error && <p className="text-[11px] text-red-500">{error}</p>}

      {/* Step 1: pick a saved shot. Hover the card to preview the clip. */}
      {phase === "pick-shot" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {shots.length === 0 && (
            <p className="col-span-full text-[12px] text-neutral-500 leading-snug py-4">
              No saved shots yet. Build one first via the New Shot flow.
            </p>
          )}
          {shots.map((shot) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => pickShot(shot)}
              className="group flex flex-col rounded-2xl border border-neutral-200 dark:border-neutral-800 hover:border-neutral-900 dark:hover:border-white transition overflow-hidden text-left"
            >
              <div className="aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative">
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
                {!shot.lastFrameImageUrl && (
                  <span className="absolute top-1.5 right-1.5 text-[9px] uppercase tracking-[0.12em] text-white bg-amber-700/85 px-2 py-0.5 rounded-full">
                    no seed
                  </span>
                )}
              </div>
              <div className="p-2.5 bg-white dark:bg-neutral-950">
                <p
                  className="text-[10px] text-neutral-500 leading-snug line-clamp-2"
                  title={shot.animationPrompt}
                >
                  {shot.animationPrompt || "(no prompt saved)"}
                </p>
                <p className="text-[10px] text-neutral-400 mt-0.5">
                  {new Date(shot.savedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: animation prompt against the seed frame */}
      {(phase === "frame-ready" || phase === "animating") && sourceShot?.lastFrameImageUrl && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="sm:w-1/2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceShot.lastFrameImageUrl}
              alt=""
              className="w-full aspect-[9/16] object-cover rounded-2xl border border-neutral-200 dark:border-neutral-800"
            />
            <p className="text-[10px] text-neutral-500 leading-snug mt-2">
              Seed: last frame from prior shot
            </p>
          </div>
          <div className="sm:w-1/2 flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
              Animation prompt
              {busy === "anim-prompt" && (
                <span className="normal-case text-neutral-400"> — Claude is writing one…</span>
              )}
            </label>
            <textarea
              value={animationPrompt}
              onChange={(e) => setAnimationPrompt(e.target.value)}
              disabled={phase === "animating" || busy === "anim-prompt"}
              rows={6}
              placeholder="What happens next? Plain English."
              className="w-full px-3 py-2 rounded-xl text-[11px] leading-snug border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none disabled:opacity-60"
            />
            <div className="flex flex-wrap gap-2">
              {phase === "frame-ready" && (
                <>
                  <button
                    type="button"
                    onClick={animate}
                    disabled={!!busy || !animationPrompt.trim()}
                    className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
                  >
                    Animate →
                  </button>
                  <button
                    type="button"
                    onClick={writeAnimWithAi}
                    disabled={!!busy}
                    className="px-3 py-2 rounded-full text-[11px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-60"
                    title="Use the prior shot's prompt as a seed for a fresh direction"
                  >
                    Re-write with AI
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSourceShot(null);
                      setAnimationPrompt("");
                      setPhase("pick-shot");
                    }}
                    className="px-3 py-2 rounded-full text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    Pick a different shot
                  </button>
                </>
              )}
              {phase === "animating" && (
                <span className="text-[11px] text-neutral-500">Animating with Kling v3 Pro…</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: review */}
      {phase === "review" && resultVideoUrl && sourceShot?.lastFrameImageUrl && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="sm:w-1/2">
            <video
              src={resultVideoUrl}
              autoPlay
              loop
              muted
              playsInline
              controls
              className="w-full aspect-[9/16] object-cover rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-black"
            />
          </div>
          <div className="sm:w-1/2 flex flex-col gap-2">
            <p className="text-[12px] font-semibold tracking-tight">Animation ready</p>
            <p className="text-[11px] text-neutral-500 leading-snug">
              Save to add this shot to the project's library, or reprompt to try a different
              direction without changing seeds.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                onClick={saveShot}
                className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900"
              >
                Save shot
              </button>
              <button
                type="button"
                onClick={reprompt}
                className="px-4 py-2 rounded-full text-[12px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                Reprompt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
