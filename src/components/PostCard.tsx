"use client";

import { useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import type {
  CompositeTextZone,
  PaletteKey,
  PhotoCompositeData,
  Post,
  StyleVariant,
} from "@/lib/types";
import { PALETTE_KEYS, PALETTE_LABELS, PALETTES } from "@/lib/types";
import {
  composeGraphicDataUrl,
  dataUrlToBlob,
  fetchOneCopy,
  fetchPhotoFor,
  uploadStaticImage,
} from "@/lib/client";
import { AI_CREDIT_LABEL, randomPrompt } from "@/lib/imagePrompts";
import { EditTextModal } from "./EditTextModal";
import { BufferSendModal } from "./BufferSendModal";

type RecomposeOverrides = Partial<{
  headline: string;
  cta: string;
  style: StyleVariant;
  textZone: CompositeTextZone;
  photoUrl: string;
}>;

export function PostCard({ post }: { post: Post }) {
  const { language, contentType, updatePost, usedPhotoIds, addUsedPhotoId } = useBatchStore();
  const [busy, setBusy] = useState<null | "photo" | "copy" | "tweak" | "ai">(null);
  const [editing, setEditing] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [imageDownloaded, setImageDownloaded] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  // Buffer flow state — only used by graphic posts. Uploading the
  // rendered PNG to R2 happens lazily on first Send-to-Buffer click;
  // the resulting URL is cached so re-opening the modal doesn't re-upload.
  const [bufferSendOpen, setBufferSendOpen] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [bufferPrep, setBufferPrep] = useState<"idle" | "uploading" | "error">("idle");
  const [bufferPrepError, setBufferPrepError] = useState<string | null>(null);
  const [bufferReceipt, setBufferReceipt] = useState<{ platforms: string[] } | null>(null);

  async function recompose(overrides: RecomposeOverrides = {}) {
    const photoUrl = overrides.photoUrl ?? post.photoUrl;
    if (!photoUrl) return;
    // Photo posts now route through the same compose-graphic
    // pipeline as AI posters (Vision-picked placement + halo +
    // grouped headline/cta), so we build a PhotoCompositeData on
    // the fly from the post's fields.
    const style = overrides.style ?? post.style;
    const photoGraphic: PhotoCompositeData = {
      template: "photo",
      headline: overrides.headline ?? post.headline,
      subline: overrides.cta ?? post.cta,
      photoUrl,
      textZone: (overrides.textZone ?? post.textZone ?? "bottom") as CompositeTextZone,
      plain: style === "plain",
    };
    return composeGraphicDataUrl(photoGraphic);
  }

  // "New image" shuffle. With the image library, this is a 50/50 mix:
  //   - Half the time pull a random cached AI image (skipping the post's
  //     current photoUrl so we always get a different one).
  //   - The other half (or fallback when cache is empty) pull a fresh
  //     Pexels stock photo.
  async function regenImage() {
    setBusy("photo");
    try {
      const tryCache = Math.random() < 0.5;
      let photoUrl: string | null = null;
      let credit: { photographer: string; sourceUrl: string } | null = null;

      if (tryCache) {
        const { pickRandomLibraryImages } = await import("@/lib/imageLibrary");
        const [pick] = pickRandomLibraryImages(1, post.photoUrl ? [post.photoUrl] : []);
        if (pick) {
          photoUrl = pick.url;
          credit = { photographer: AI_CREDIT_LABEL, sourceUrl: "" };
        }
      }

      if (!photoUrl) {
        const photo = await fetchPhotoFor(contentType, usedPhotoIds);
        addUsedPhotoId(photo.id);
        photoUrl = photo.url;
        credit = { photographer: photo.photographer, sourceUrl: photo.sourceUrl };
      }

      const imageDataUrl = await recompose({ photoUrl: photoUrl ?? undefined });
      updatePost(post.id, {
        photoUrl: photoUrl ?? post.photoUrl,
        photoCredit: credit ?? { photographer: AI_CREDIT_LABEL, sourceUrl: "" },
        imageDataUrl,
      });
    } catch (e) {
      alert("Image regen failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(null);
    }
  }

  async function genAiImage() {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    setBusy("ai");
    try {
      // Use fetchAndCacheAiImage so manual AI gens also land in the
      // image library (mirrored to R2, available in future batches).
      const { fetchAndCacheAiImage } = await import("@/lib/client");
      const ai = await fetchAndCacheAiImage(prompt, "manual");
      const imageDataUrl = await recompose({ photoUrl: ai.url });
      updatePost(post.id, {
        photoUrl: ai.url,
        photoCredit: { photographer: AI_CREDIT_LABEL, sourceUrl: "" },
        imageDataUrl,
      });
    } catch (e) {
      alert("AI image failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(null);
    }
  }

  async function regenCopy() {
    setBusy("copy");
    try {
      const fresh = await fetchOneCopy(language, contentType, post.angle);
      const imageDataUrl = await recompose({ headline: fresh.headline, cta: fresh.cta });
      updatePost(post.id, {
        headline: fresh.headline,
        cta: fresh.cta,
        caption: fresh.caption,
        imageDataUrl: imageDataUrl ?? post.imageDataUrl,
      });
    } catch (e) {
      alert("Copy regen failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(null);
    }
  }

  async function applyPalette(nextPalette: PaletteKey) {
    if (!post.graphic) return;
    if (post.graphic.template !== "stat" && post.graphic.template !== "did_you_know" && post.graphic.template !== "promo") {
      return;
    }
    if (post.graphic.palette === nextPalette) return;
    setBusy("tweak");
    try {
      const nextGraphic = { ...post.graphic, palette: nextPalette };
      const imageDataUrl = await composeGraphicDataUrl(nextGraphic);
      updatePost(post.id, { graphic: nextGraphic, imageDataUrl });
    } catch (e) {
      alert("Palette swap failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(null);
    }
  }

  async function cycleStyle() {
    if (!post.photoUrl) return;
    // Only Light ↔ Plain are exposed in the UI now; Branded and Sepia
    // remain on the StyleVariant union for back-compat with old saved
    // posts but never re-enter the rotation. If a post somehow already
    // sits on "branded" or "sepia", the next click jumps to "light".
    const next: StyleVariant = post.style === "light" ? "plain" : "light";
    setBusy("tweak");
    try {
      const imageDataUrl = await recompose({ style: next });
      updatePost(post.id, { style: next, imageDataUrl });
    } catch (e) {
      alert("Style swap failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(next: { headline: string; cta: string; caption: string }) {
    setEditing(false);
    if (!post.photoUrl) {
      updatePost(post.id, next);
      return;
    }
    try {
      const imageDataUrl = await recompose({ headline: next.headline, cta: next.cta });
      updatePost(post.id, { ...next, imageDataUrl: imageDataUrl ?? post.imageDataUrl });
    } catch (e) {
      alert("Recompose failed: " + (e instanceof Error ? e.message : "unknown"));
    }
  }

  function copyCaption() {
    navigator.clipboard.writeText(post.caption).then(() => {
      setCaptionCopied(true);
      setTimeout(() => setCaptionCopied(false), 1500);
    });
  }

  async function openBufferSend() {
    if (!post.imageDataUrl || !post.language) return;
    if (uploadedImageUrl) {
      // Already uploaded earlier — just reopen the modal.
      setBufferSendOpen(true);
      return;
    }
    setBufferPrep("uploading");
    setBufferPrepError(null);
    try {
      const { cachedUrl } = await uploadStaticImage(post.imageDataUrl);
      setUploadedImageUrl(cachedUrl);
      setBufferSendOpen(true);
      setBufferPrep("idle");
    } catch (e) {
      setBufferPrep("error");
      setBufferPrepError(e instanceof Error ? e.message : "upload failed");
    }
  }

  function downloadImage() {
    if (!post.imageDataUrl) return;
    const blob = dataUrlToBlob(post.imageDataUrl);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${post.angle}.png`;
    a.click();
    URL.revokeObjectURL(url);
    setImageDownloaded(true);
    setTimeout(() => setImageDownloaded(false), 1500);
  }

  // The Style chip toggles between full overlay (Light) and bare-photo
  // mode (Plain). Branded / Sepia stay on the StyleVariant union for
  // back-compat but never re-enter the rotation.
  const styleChipLabel = post.style === "plain" ? "Plain" : "Overlay";
  // Graphic posts skip every photo-specific affordance: no photo edit
  // (no underlying photo to reposition), no AI prompt input (the design
  // is pure SVG), no New-image / New-caption regen (graphics regen via
  // a fresh full batch), no font / style / fit chips (template-locked).
  const isGraphic = post.staticSubMode === "graphic";

  return (
    <div className="rounded-3xl overflow-hidden border bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-900 shadow-[0_2px_8px_-3px_rgba(0,0,0,0.08)] hover:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.15)] transition-shadow flex flex-col">
      <div className="aspect-[4/5] bg-neutral-100 dark:bg-neutral-800 relative group/image">
        {post.imageDataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.imageDataUrl} alt={post.angle} className="w-full h-full object-cover" />
            <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-100 lg:opacity-0 lg:group-hover/image:opacity-100 transition focus-within:opacity-100">
              <button
                onClick={downloadImage}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-black/70 text-white backdrop-blur-md hover:bg-black/85"
                title="Download PNG"
              >
                {imageDownloaded ? "Downloaded" : "Download"}
              </button>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">
            {busy === "photo" ? "Regenerating image…" : "Loading image…"}
          </div>
        )}

        {busy === "tweak" && post.imageDataUrl && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center text-white text-sm">
            Updating…
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className="truncate text-[10px] uppercase tracking-[0.14em] text-neutral-400 dark:text-neutral-600 font-medium"
            title={post.angle}
          >
            {post.angle.replace(/_/g, " ")}
          </span>
          {!isGraphic && (
            <div className="flex gap-1 shrink-0 text-[10px] uppercase tracking-[0.1em] text-neutral-500">
              <Chip onClick={cycleStyle} disabled={busy !== null || !post.photoUrl} title="Toggle text overlay on/off">
                {styleChipLabel}
              </Chip>
            </div>
          )}
          {isGraphic && post.graphic && (
            <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-neutral-500 font-medium">
              {post.graphic.template.replace(/_/g, " ")}
            </span>
          )}
        </div>

        {/* Palette swatches. Only Stat / DYK / Promo support palette
            swap (AI poster + photo composite use Vision-picked colors
            instead of fixed palettes). Click a swatch to recompose. */}
        {isGraphic &&
          post.graphic &&
          (post.graphic.template === "stat" ||
            post.graphic.template === "did_you_know" ||
            post.graphic.template === "promo") && (
            <div className="flex gap-1.5 pt-1" role="group" aria-label="Palette">
              {PALETTE_KEYS.map((k) => {
                const p = PALETTES[k];
                const isActive = (post.graphic && "palette" in post.graphic
                  ? post.graphic.palette
                  : undefined) === k ||
                  (k === "classic" &&
                    (!post.graphic || !("palette" in post.graphic) || !post.graphic.palette));
                return (
                  <button
                    key={k}
                    onClick={() => applyPalette(k)}
                    disabled={busy !== null}
                    title={PALETTE_LABELS[k]}
                    aria-label={`Palette: ${PALETTE_LABELS[k]}`}
                    className={`w-5 h-5 rounded-full border transition disabled:opacity-50 ${
                      isActive
                        ? "ring-2 ring-offset-1 ring-offset-white dark:ring-offset-neutral-950 ring-neutral-900 dark:ring-neutral-100 border-transparent"
                        : "border-neutral-300 dark:border-neutral-700 hover:scale-110"
                    }`}
                    style={{ background: p.bg }}
                  >
                    {/* Small ink dot inside so the white-on-white classic
                        palette doesn't disappear against light card bg. */}
                    <span
                      className="block w-1.5 h-1.5 rounded-full mx-auto"
                      style={{ background: p.ink }}
                    />
                  </button>
                );
              })}
            </div>
          )}

        {/* Caption with hover-to-copy. Scrollable so the full body is readable
            without truncation; the surrounding card grows to a sane height via
            grid auto-rows-fr and very long captions scroll inside this box. */}
        <div className="relative group/caption flex-1 min-h-[160px]">
          <div className="absolute inset-0 overflow-y-auto pr-2 -mr-2">
            <p className="text-[13px] whitespace-pre-wrap leading-relaxed text-neutral-800 dark:text-neutral-200">
              {post.caption}
            </p>
          </div>
          <button
            onClick={copyCaption}
            className="absolute top-0 right-0 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-neutral-900/90 dark:bg-neutral-100 text-white dark:text-neutral-900 backdrop-blur-md opacity-100 lg:opacity-0 lg:group-hover/caption:opacity-100 transition focus:opacity-100"
            title="Copy caption to clipboard"
          >
            {captionCopied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* AI image prompt — generates via Nano Banana 2 and replaces the photo.
            Input is full-width on its own row so long prompts stay readable;
            shuffle + generate sit underneath. Photo-mode only. */}
        {!isGraphic && (
        <div className="flex flex-col gap-1.5">
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") genAiImage();
            }}
            disabled={busy !== null}
            placeholder="Describe an AI image…"
            className="w-full px-3 py-2 rounded-xl text-[13px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 disabled:opacity-50 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => setAiPrompt(randomPrompt())}
              disabled={busy !== null}
              title="Shuffle a prompt idea"
              className="px-3 py-1.5 rounded-full text-xs font-medium border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
            >
              🎲 Shuffle
            </button>
            <button
              onClick={genAiImage}
              disabled={busy !== null || !aiPrompt.trim()}
              className="ml-auto px-4 py-1.5 rounded-full text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:hover:bg-white text-white dark:text-neutral-900 disabled:opacity-40"
            >
              {busy === "ai" ? "…" : "Generate"}
            </button>
          </div>
        </div>
        )}

        {!isGraphic && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <BtnSmall onClick={regenImage} disabled={busy !== null}>
              {busy === "photo" ? "…" : "New image"}
            </BtnSmall>
            <BtnSmall onClick={regenCopy} disabled={busy !== null}>
              {busy === "copy" ? "…" : "New caption"}
            </BtnSmall>
            <BtnSmall onClick={() => setEditing(true)}>Edit text</BtnSmall>
          </div>
        )}

        {/* Send-to-Buffer is available on every static post with a
            rendered image — photo or graphic. The upload + queue flow
            doesn't care which template produced the PNG. */}
        {post.imageDataUrl && (
          <div className="flex flex-col gap-2 pt-1">
            {bufferReceipt ? (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-[12px] text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>
                  Queued in Buffer for{" "}
                  {bufferReceipt.platforms.length === 0
                    ? "no channels"
                    : bufferReceipt.platforms.join(" · ")}
                  .
                </span>
              </div>
            ) : (
              <button
                onClick={openBufferSend}
                disabled={!post.language || bufferPrep === "uploading"}
                title={
                  !post.language
                    ? "Older post — language wasn't recorded. Regenerate the batch to enable Buffer send."
                    : undefined
                }
                className="w-full px-4 py-2.5 rounded-2xl text-[12px] font-semibold border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-900 dark:text-neutral-100 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {bufferPrep === "uploading" ? (
                  <>
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    <span>Preparing image…</span>
                  </>
                ) : (
                  <span>Send to Buffer</span>
                )}
              </button>
            )}
            {bufferPrepError && (
              <p className="text-[11px] text-red-500 leading-snug">{bufferPrepError}</p>
            )}
          </div>
        )}

        {post.photoCredit && (
          <div className="text-[10px] text-neutral-400 dark:text-neutral-600 pt-1 mt-auto">
            {post.photoCredit.photographer.startsWith("AI ")
              ? post.photoCredit.photographer
              : `Photo · ${post.photoCredit.photographer} on Pexels`}
          </div>
        )}
      </div>

      {editing && (
        <EditTextModal
          initial={{ headline: post.headline, cta: post.cta, caption: post.caption }}
          onCancel={() => setEditing(false)}
          onSave={saveEdit}
        />
      )}

      {bufferSendOpen && uploadedImageUrl && post.language && (
        <BufferSendModal
          language={post.language}
          imageUrl={uploadedImageUrl}
          caption={post.caption}
          conceptKey={post.graphic?.template === "ai_poster" ? post.graphic.conceptKey : undefined}
          onClose={() => setBufferSendOpen(false)}
          onSuccess={(queued) =>
            setBufferReceipt({ platforms: queued.map((q) => q.platform) })
          }
        />
      )}
    </div>
  );
}


function Chip({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
    >
      {children}
    </button>
  );
}

function BtnSmall({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  const base = "px-3 py-1.5 rounded-full text-xs font-medium border transition";
  const styles =
    "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}
