"use client";

import { useEffect, useState } from "react";
import {
  animateSourceImage,
  generateCustomImage,
  mirrorClip,
  tagClip,
  type AnimationModel,
} from "@/lib/videoClient";
import { addLibraryClip, updateLibraryClip } from "@/lib/clipLibrary";

const DEFAULT_ANIMATION_PROMPT =
  "subtle camera movement, slow steady push-in, no abrupt motion";

type Step = "image" | "animation";

export interface AiClipResult {
  libraryClipId: string;
  videoUrl: string;
}

export function AiClipModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: AiClipResult) => void;
}) {
  const [step, setStep] = useState<Step>("image");

  // Image step state.
  const [imagePrompt, setImagePrompt] = useState("");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Animation step state.
  const [animationPrompt, setAnimationPrompt] = useState(DEFAULT_ANIMATION_PROMPT);
  const [animationModel, setAnimationModel] = useState<AnimationModel>("seedance");
  const [animating, setAnimating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [animationError, setAnimationError] = useState<string | null>(null);

  // Final save state.
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Esc key closes the modal (unless something is mid-flight).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !generatingImage && !animating && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, generatingImage, animating, saving]);

  async function onGenerateImage() {
    const prompt = imagePrompt.trim();
    if (!prompt || generatingImage) return;
    setImageError(null);
    setGeneratingImage(true);
    try {
      const { url } = await generateCustomImage(prompt);
      setImageUrl(url);
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "image generation failed");
    } finally {
      setGeneratingImage(false);
    }
  }

  async function onAnimate() {
    if (!imageUrl || animating) return;
    setAnimationError(null);
    setAnimating(true);
    try {
      const { url } = await animateSourceImage(imageUrl, animationModel, animationPrompt.trim() || undefined);
      setVideoUrl(url);
    } catch (e) {
      setAnimationError(e instanceof Error ? e.message : "animation failed");
    } finally {
      setAnimating(false);
    }
  }

  async function onSave() {
    if (!imageUrl || !videoUrl || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      // Mirror both image and video to R2 so the library entry survives
      // fal.ai URL expiration.
      const [{ cachedUrl: mirroredImage }, { cachedUrl: mirroredVideo }] = await Promise.all([
        mirrorClip({ url: imageUrl, kind: "image" }),
        mirrorClip({ url: videoUrl, kind: "video" }),
      ]);
      const clip = addLibraryClip({
        url: mirroredVideo,
        posterUrl: mirroredImage,
        kind: "auto",
        filename: imagePrompt.trim().slice(0, 80),
        language: "multi",
      });
      // Fire-and-forget vision tag pass — same as auto-archived clips.
      void tagClip(clip.url)
        .then((tags) => updateLibraryClip(clip.id, { tags }))
        .catch(() => undefined);
      onCreated({ libraryClipId: clip.id, videoUrl: mirroredVideo });
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "save failed");
      setSaving(false);
    }
  }

  const busy = generatingImage || animating || saving;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-neutral-950 rounded-3xl border border-neutral-200 dark:border-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-900 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Generate AI clip</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              {step === "image" ? "Step 1 of 2 · Describe the image" : "Step 2 of 2 · Describe the animation"}
            </p>
          </div>
          <button
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:opacity-40"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        {step === "image" ? (
          <div className="p-6 flex flex-col gap-4 overflow-y-auto">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Describe the image
              </span>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="e.g. A bright modern living room with sunlight pouring through tall windows and a sleeping golden retriever on a beige rug"
                rows={3}
                disabled={generatingImage}
                className="w-full px-3 py-2 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600 disabled:opacity-60"
              />
              <span className="text-[10px] text-neutral-500">
                We&apos;ll add the 9:16 vertical + photorealistic styling automatically.
              </span>
            </label>

            {imageUrl && (
              <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-900 aspect-[9/16] max-h-[420px] mx-auto bg-neutral-100 dark:bg-neutral-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Generated" className="w-full h-full object-cover" />
              </div>
            )}

            {imageError && (
              <p className="text-[12px] text-red-500">{imageError}</p>
            )}

            <div className="flex justify-between items-center pt-2 gap-2">
              <button
                onClick={onClose}
                disabled={busy}
                className="text-[12px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:opacity-40"
              >
                Cancel
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onGenerateImage}
                  disabled={!imagePrompt.trim() || generatingImage}
                  className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-900 dark:text-neutral-100 disabled:opacity-40 transition flex items-center gap-2"
                >
                  {generatingImage ? <><Spinner /> Generating…</> : imageUrl ? "Regenerate" : "Generate image"}
                </button>
                {imageUrl && !generatingImage && (
                  <button
                    onClick={() => setStep("animation")}
                    className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 transition"
                  >
                    Looks good →
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 flex flex-col gap-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              {imageUrl && (
                <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-900 aspect-[9/16] bg-neutral-100 dark:bg-neutral-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="Source" className="w-full h-full object-cover" />
                </div>
              )}
              <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-900 aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 flex items-center justify-center">
                {videoUrl ? (
                  <video
                    src={videoUrl}
                    controls
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : animating ? (
                  <div className="flex flex-col items-center gap-2 text-neutral-500 text-[11px]">
                    <Spinner />
                    Animating…
                  </div>
                ) : (
                  <span className="text-[11px] text-neutral-500">Animation will appear here</span>
                )}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Describe the motion
              </span>
              <textarea
                value={animationPrompt}
                onChange={(e) => setAnimationPrompt(e.target.value)}
                rows={2}
                disabled={animating}
                placeholder={DEFAULT_ANIMATION_PROMPT}
                className="w-full px-3 py-2 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600 disabled:opacity-60"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Animation engine
              </span>
              <div className="grid grid-cols-2 gap-2">
                <ModelPill
                  label="Seedance"
                  hint="Sharper, 1080p"
                  selected={animationModel === "seedance"}
                  onClick={() => setAnimationModel("seedance")}
                  disabled={animating}
                />
                <ModelPill
                  label="Kling"
                  hint="Better with people"
                  selected={animationModel === "kling"}
                  onClick={() => setAnimationModel("kling")}
                  disabled={animating}
                />
              </div>
            </div>

            {animationError && (
              <p className="text-[12px] text-red-500">{animationError}</p>
            )}
            {saveError && <p className="text-[12px] text-red-500">{saveError}</p>}

            <div className="flex justify-between items-center pt-2 gap-2">
              <button
                onClick={() => !busy && setStep("image")}
                disabled={busy}
                className="text-[12px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:opacity-40"
              >
                ← Back to image
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onAnimate}
                  disabled={!imageUrl || animating || saving}
                  className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-900 dark:text-neutral-100 disabled:opacity-40 transition flex items-center gap-2"
                >
                  {animating ? <><Spinner /> Animating…</> : videoUrl ? "Regenerate" : "Animate"}
                </button>
                {videoUrl && !animating && (
                  <button
                    onClick={onSave}
                    disabled={saving}
                    className="px-4 py-2 rounded-full text-[12px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-white disabled:opacity-40 transition flex items-center gap-2"
                  >
                    {saving ? <><Spinner /> Saving…</> : "Save to library"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ModelPill({
  label,
  hint,
  selected,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-2 rounded-2xl border text-left transition disabled:opacity-50 ${
        selected
          ? "bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white text-white dark:text-neutral-900"
          : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      }`}
    >
      <div className="text-[12px] font-semibold">{label}</div>
      <div className="text-[10px] opacity-70 mt-0.5">{hint}</div>
    </button>
  );
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
