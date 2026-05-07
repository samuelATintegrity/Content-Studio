"use client";

import { useEffect, useRef, useState } from "react";
import {
  storyAnimateShot,
  storyGenerateFrame,
  storyUploadFrame,
  storyWriteAnimationPrompt,
} from "@/lib/storyBuilder";
import {
  addGeneratedStartingFrame,
  addUploadedStartingFrame,
  listStoryStartingFrames,
  subscribeStoryStartingFrames,
} from "@/lib/storyStartingFrames";
import { addStoryShot } from "@/lib/storyShots";
import type { StoryStartingFrame } from "@/lib/types";

interface Props {
  projectId: string;
  onClose: () => void;
}

// Three-step wizard:
//   step 1: pick first frame → upload | generate | library
//   step 2: animation prompt → animate
//   step 3: review animation → save | reprompt
//
// State machine:
//   "pick-source"     — user choosing among the three first-frame paths
//   "generating"      — Nano running
//   "frame-ready"     — first frame committed (came from any path); animation prompt step
//   "animating"       — Kling running
//   "review"          — animation done; save / reprompt buttons
//
// On Save we addStoryShot(); the helper auto-deposits the lastFrame
// into the StartingFrame library so next time a Continue or Library
// pick can find it.

type Phase =
  | "pick-source"
  | "generating-frame"
  | "frame-ready"
  | "animating"
  | "review";

export function NewShotWizard({ projectId, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("pick-source");
  const [busy, setBusy] = useState<"upload" | "generate" | "anim-prompt" | "animate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // First-frame selection state.
  const [framePrompt, setFramePrompt] = useState("");
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null);
  const [frameSource, setFrameSource] = useState<"upload" | "generated" | "library" | null>(null);

  // Animation state.
  const [animationPrompt, setAnimationPrompt] = useState("");
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);
  const [resultLastFrameUrl, setResultLastFrameUrl] = useState<string | undefined>(undefined);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<StoryStartingFrame[]>(() =>
    listStoryStartingFrames(projectId),
  );

  useEffect(
    () => subscribeStoryStartingFrames(() => setLibrary(listStoryStartingFrames(projectId))),
    [projectId],
  );

  function reset() {
    setPhase("pick-source");
    setFramePrompt("");
    setFrameImageUrl(null);
    setFrameSource(null);
    setAnimationPrompt("");
    setResultVideoUrl(null);
    setResultLastFrameUrl(undefined);
    setLibraryOpen(false);
    setError(null);
  }

  // ── First-frame: upload ─────────────────────────────────────────

  async function onUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy("upload");
    try {
      const { cachedUrl } = await storyUploadFrame(file);
      addUploadedStartingFrame({ projectId, imageUrl: cachedUrl });
      setFrameImageUrl(cachedUrl);
      setFrameSource("upload");
      setPhase("frame-ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setBusy(null);
    }
  }

  // ── First-frame: generate via Nano ──────────────────────────────

  async function generate() {
    if (busy) return;
    if (!framePrompt.trim()) {
      setError("Describe the first frame first.");
      return;
    }
    setError(null);
    setBusy("generate");
    setPhase("generating-frame");
    try {
      const { url } = await storyGenerateFrame(framePrompt.trim());
      // Don't deposit into the library yet — the user is still in
      // retry/use mode. We commit on "Use this frame" below.
      setFrameImageUrl(url);
      // Stay in generating-frame phase visually but show the result.
      setPhase("generating-frame");
    } catch (err) {
      setError(err instanceof Error ? err.message : "generate failed");
      setPhase("pick-source");
    } finally {
      setBusy(null);
    }
  }

  function commitGeneratedFrame() {
    if (!frameImageUrl || !framePrompt.trim()) return;
    addGeneratedStartingFrame({
      projectId,
      imageUrl: frameImageUrl,
      prompt: framePrompt.trim(),
    });
    setFrameSource("generated");
    setPhase("frame-ready");
  }

  function discardGeneratedFrame() {
    setFrameImageUrl(null);
    setPhase("pick-source");
  }

  // ── First-frame: pick from library ──────────────────────────────

  function pickFromLibrary(frame: StoryStartingFrame) {
    setFrameImageUrl(frame.imageUrl);
    setFrameSource("library");
    setLibraryOpen(false);
    setPhase("frame-ready");
  }

  // ── Animation ───────────────────────────────────────────────────

  async function writeAnimWithAi() {
    if (busy) return;
    if (!framePrompt.trim()) {
      setError("Add a short description above first so Claude has something to work from.");
      return;
    }
    setError(null);
    setBusy("anim-prompt");
    try {
      const { animationPrompt: ap } = await storyWriteAnimationPrompt({
        imagePrompt: framePrompt.trim(),
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
    if (busy) return;
    if (!frameImageUrl) {
      setError("Pick a first frame first.");
      return;
    }
    if (!animationPrompt.trim()) {
      setError("Animation prompt cannot be empty.");
      return;
    }
    setError(null);
    setBusy("animate");
    setPhase("animating");
    try {
      const { videoUrl, lastFrameImageUrl } = await storyAnimateShot({
        imageUrl: frameImageUrl,
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

  // ── Review: save or reprompt ────────────────────────────────────

  function saveShot() {
    if (!frameImageUrl || !resultVideoUrl) return;
    addStoryShot({
      projectId,
      startingFrameImageUrl: frameImageUrl,
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
            New shot
          </span>
          <h2 className="text-base font-semibold tracking-tight">
            {phase === "pick-source" || phase === "generating-frame"
              ? "Step 1: First frame"
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

      {/* Step 1: pick source */}
      {phase === "pick-source" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Upload tile */}
            <button
              type="button"
              onClick={() => !busy && uploadInputRef.current?.click()}
              disabled={!!busy}
              className="flex flex-col items-center justify-center gap-2 aspect-[9/16] rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 hover:border-neutral-500 transition px-4 text-center bg-neutral-50 dark:bg-neutral-950 disabled:opacity-50"
            >
              <UploadIcon />
              <span className="text-[12px] font-medium">
                {busy === "upload" ? "Uploading…" : "Upload first frame"}
              </span>
              <span className="text-[10px] text-neutral-500 leading-tight">
                Bring your own jpg / png. Mirrored to R2 by sha — same file twice is a no-op.
              </span>
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/*"
              onChange={onUploadFile}
              className="hidden"
            />

            {/* Generate tile (with inline prompt) */}
            <div className="flex flex-col gap-2 aspect-[9/16] rounded-2xl border-2 border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-50 dark:bg-neutral-950">
              <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
                Generate first frame
              </label>
              <textarea
                value={framePrompt}
                onChange={(e) => setFramePrompt(e.target.value)}
                placeholder="e.g. a robin perched on a fence post at dawn, soft golden light"
                disabled={!!busy}
                rows={6}
                className="flex-1 w-full px-3 py-2 rounded-xl text-[11px] leading-snug border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={generate}
                disabled={!!busy || !framePrompt.trim()}
                className="mt-auto px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-50"
              >
                Generate →
              </button>
            </div>

            {/* Library tile */}
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              disabled={!!busy || library.length === 0}
              className={`flex flex-col items-center justify-center gap-2 aspect-[9/16] rounded-2xl border-2 transition px-4 text-center ${
                library.length === 0
                  ? "border-dashed border-neutral-200 dark:border-neutral-800 text-neutral-400 cursor-not-allowed"
                  : "border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 hover:bg-white dark:hover:bg-neutral-900"
              }`}
              title={library.length === 0 ? "No saved frames yet" : undefined}
            >
              <LibraryIcon />
              <span className="text-[12px] font-medium">
                Pick from library
              </span>
              <span className="text-[10px] text-neutral-500 leading-tight">
                {library.length === 0
                  ? "No saved frames yet — uploads, generated frames, and saved-shot last-frames all land here."
                  : `${library.length} saved frame${library.length === 1 ? "" : "s"}`}
              </span>
            </button>
          </div>

          {/* Library picker modal-ish */}
          {libraryOpen && (
            <div className="flex flex-col gap-3 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                  Starting frames in this project
                </h3>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(false)}
                  className="text-[10px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  Close
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {library.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => pickFromLibrary(f)}
                    className="aspect-[9/16] rounded-xl overflow-hidden border-2 border-neutral-200 dark:border-neutral-800 hover:border-neutral-900 dark:hover:border-white transition relative"
                    title={f.prompt ?? f.source}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.imageUrl} alt="" className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 px-1 py-0.5 bg-black/60 text-white text-[8px] uppercase tracking-[0.1em] text-center">
                      {f.source === "extracted-from-shot" ? "from shot" : f.source}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Generating-frame phase: show the result + retry/use buttons */}
      {phase === "generating-frame" && (
        <div className="flex flex-col gap-3">
          {!frameImageUrl ? (
            <p className="text-[12px] text-neutral-500 py-6 text-center">
              Composing the still… (Nano Banana 2)
            </p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="sm:w-1/2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frameImageUrl}
                  alt=""
                  className="w-full aspect-[9/16] object-cover rounded-2xl border border-neutral-200 dark:border-neutral-800"
                />
              </div>
              <div className="sm:w-1/2 flex flex-col gap-2">
                <p className="text-[12px] text-neutral-600 dark:text-neutral-400 leading-snug">
                  How does it look?
                </p>
                <div className="flex flex-wrap gap-2 mt-1">
                  <button
                    type="button"
                    onClick={commitGeneratedFrame}
                    className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900"
                  >
                    Use this frame →
                  </button>
                  <button
                    type="button"
                    onClick={generate}
                    disabled={!!busy}
                    className="px-4 py-2 rounded-full text-[12px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
                  >
                    {busy === "generate" ? "Re-rolling…" : "Re-roll"}
                  </button>
                  <button
                    type="button"
                    onClick={discardGeneratedFrame}
                    className="px-3 py-2 rounded-full text-[12px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    Discard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: animation prompt */}
      {(phase === "frame-ready" || phase === "animating") && frameImageUrl && (
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="sm:w-1/2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={frameImageUrl}
              alt=""
              className="w-full aspect-[9/16] object-cover rounded-2xl border border-neutral-200 dark:border-neutral-800"
            />
            <p className="text-[10px] text-neutral-500 mt-2 leading-snug">
              First frame {frameSource && <>· <span className="font-medium">{frameSource}</span></>}
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
              placeholder="What should move? Plain English — short is better."
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
                    disabled={!!busy || !framePrompt.trim()}
                    className="px-3 py-2 rounded-full text-[11px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-60"
                    title={
                      framePrompt.trim()
                        ? "Use the first-frame description to draft an animation prompt"
                        : "Add a description in step 1 first"
                    }
                  >
                    {animationPrompt.trim() ? "Re-write with AI" : "Write with AI"}
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
      {phase === "review" && resultVideoUrl && frameImageUrl && (
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
              animation direction without re-doing the first frame.
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
              <button
                type="button"
                onClick={reset}
                className="px-3 py-2 rounded-full text-[12px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                title="Throw away the animation AND the first frame, start over"
              >
                Throw away
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="w-7 h-7 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg className="w-7 h-7 text-neutral-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" stroke="none" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
