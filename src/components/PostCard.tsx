"use client";

import { useEffect, useRef, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import type {
  CompositeTextZone,
  FitMode,
  Framing,
  PhotoCompositeData,
  Post,
  StyleVariant,
} from "@/lib/types";
import { brand } from "../../brand.config";
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
  framing: Post["framing"];
  fitMode: FitMode;
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
  const [editingPhoto, setEditingPhoto] = useState(false);
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

  async function savePhotoEdit(framing: Framing) {
    setEditingPhoto(false);
    setBusy("tweak");
    try {
      const imageDataUrl = await recompose({ framing, fitMode: "manual" });
      updatePost(post.id, { framing, fitMode: "manual", imageDataUrl });
    } catch (e) {
      alert("Recompose failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(null);
    }
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
      {/* Image area: shows composed PNG normally; swaps in PhotoEditor when editing */}
      <div className="aspect-[4/5] bg-neutral-100 dark:bg-neutral-800 relative group/image">
        {editingPhoto && post.photoUrl ? (
          <PhotoEditor
            photoUrl={post.photoUrl}
            initialFraming={post.framing}
            initialFitMode={post.fitMode}
            style={post.style}
            onSave={savePhotoEdit}
            onCancel={() => setEditingPhoto(false)}
          />
        ) : post.imageDataUrl ? (
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

        {busy === "tweak" && post.imageDataUrl && !editingPhoto && (
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

// Free-placement photo editor.
// - Drag photo anywhere (no clamping). Movement is unconstrained during drag.
// - Slider or scroll-wheel zooms 0.3x to 3.0x. <1 reveals brand color around photo.
// - "Soft snap": when you drag near center, a green crosshair appears as a guide.
//   Releasing the mouse inside the snap zone pins the photo to perfect center on
//   that axis. Releasing outside the zone keeps your exact position.
// Coordinates are stored in canvas pixels (1080-based), converted to/from DOM pixels
// when rendering or interpreting drags.
const REGION_CANVAS_W = 1080;
const SNAP_CANVAS = 25;

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function PhotoEditor({
  photoUrl,
  initialFraming,
  initialFitMode,
  onSave,
  onCancel,
}: {
  photoUrl: string;
  initialFraming: Framing;
  initialFitMode: FitMode;
  style: StyleVariant;
  onSave: (f: Framing) => void;
  onCancel: () => void;
}) {
  // If the post wasn't already in manual mode, start with a clean centered frame
  // (cover-fit at scale 1) so the user has a sane starting point.
  const [framing, setFraming] = useState<Framing>(() =>
    initialFitMode === "manual"
      ? initialFraming
      : { x: 0, y: 0, scale: 1.0 },
  );
  const regionRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, lx: 0, ly: 0 });
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);

  // Snap guide visibility: show whenever the current position is near center.
  // This is purely visual; the actual snap is applied on mouseUp.
  const isDragging = dragRef.current.active;
  const nearCenterX = Math.abs(framing.x) < SNAP_CANVAS;
  const nearCenterY = Math.abs(framing.y) < SNAP_CANVAS;
  const snapHint: "x" | "y" | "both" | null = isDragging
    ? nearCenterX && nearCenterY
      ? "both"
      : nearCenterX
        ? "x"
        : nearCenterY
          ? "y"
          : null
    : null;

  // Force a re-render once the container is mounted so we can read its DOM size.
  const [, tick] = useState(0);
  useEffect(() => {
    tick((n) => n + 1);
  }, []);

  const regionDomW = regionRef.current?.offsetWidth ?? 0;
  const regionDomH = regionRef.current?.offsetHeight ?? 0;
  const canvasToDom = regionDomW > 0 ? regionDomW / REGION_CANVAS_W : 0;

  // Photo display geometry (DOM pixels).
  let photoDomW = 0;
  let photoDomH = 0;
  let photoDomLeft = 0;
  let photoDomTop = 0;
  if (imgDims && regionDomW > 0 && regionDomH > 0) {
    const baseRatio = Math.max(regionDomW / imgDims.w, regionDomH / imgDims.h);
    photoDomW = imgDims.w * baseRatio * framing.scale;
    photoDomH = imgDims.h * baseRatio * framing.scale;
    photoDomLeft = (regionDomW - photoDomW) / 2 + framing.x * canvasToDom;
    photoDomTop = (regionDomH - photoDomH) / 2 + framing.y * canvasToDom;
  }

  // Minimap geometry: a small thumbnail of the whole photo, with a viewport
  // rectangle showing exactly what's currently inside the 4:5 crop. Helps
  // the user see how much of the image they're cropping at higher zooms.
  const MINIMAP_MAX = 90; // px — fits comfortably top-left without crowding
  let minimapW = 0;
  let minimapH = 0;
  let viewportLeftPct = 0;
  let viewportTopPct = 0;
  let viewportWPct = 0;
  let viewportHPct = 0;
  if (imgDims && photoDomW > 0 && photoDomH > 0) {
    const imgRatio = imgDims.w / imgDims.h;
    if (imgRatio > 1) {
      minimapW = MINIMAP_MAX;
      minimapH = MINIMAP_MAX / imgRatio;
    } else {
      minimapH = MINIMAP_MAX;
      minimapW = MINIMAP_MAX * imgRatio;
    }
    // Viewport (region) position relative to the photo, expressed as percentages.
    // photoDomLeft is where the photo starts in the region; the region itself is
    // at (0,0) → (regionDomW, regionDomH). So the visible window in photo-space:
    //   left = -photoDomLeft, top = -photoDomTop, w = regionDomW, h = regionDomH.
    viewportLeftPct = clamp01((-photoDomLeft) / photoDomW) * 100;
    viewportTopPct = clamp01((-photoDomTop) / photoDomH) * 100;
    viewportWPct = clamp01(regionDomW / photoDomW) * 100;
    viewportHPct = clamp01(regionDomH / photoDomH) * 100;
    // Clip width/height so the rectangle doesn't extend past the minimap edge.
    if (viewportLeftPct + viewportWPct > 100) viewportWPct = 100 - viewportLeftPct;
    if (viewportTopPct + viewportHPct > 100) viewportHPct = 100 - viewportTopPct;
  }

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { active: true, lx: e.clientX, ly: e.clientY };
    tick((n) => n + 1);
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current.active || canvasToDom === 0) return;
    const dx_dom = e.clientX - dragRef.current.lx;
    const dy_dom = e.clientY - dragRef.current.ly;
    dragRef.current.lx = e.clientX;
    dragRef.current.ly = e.clientY;
    const dx_canvas = dx_dom / canvasToDom;
    const dy_canvas = dy_dom / canvasToDom;
    // No snap during drag — let the photo follow the cursor 1:1. The center
    // crosshair guide above shows when we're inside the snap zone, and the
    // snap is applied on mouseUp.
    setFraming((f) => ({ ...f, x: f.x + dx_canvas, y: f.y + dy_canvas }));
  }
  function endDrag() {
    if (dragRef.current.active) {
      // Snap to center on release if we ended up inside the snap zone.
      setFraming((f) => ({
        ...f,
        x: Math.abs(f.x) < SNAP_CANVAS ? 0 : f.x,
        y: Math.abs(f.y) < SNAP_CANVAS ? 0 : f.y,
      }));
    }
    dragRef.current.active = false;
    tick((n) => n + 1);
  }
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setFraming((f) => ({
      ...f,
      scale: Math.max(0.3, Math.min(3.0, f.scale + delta)),
    }));
  }

  return (
    <div className="absolute inset-0 select-none">
      {/* No band overlays during edit — the user manipulates the full canvas.
          Bands get composited on top in the final compose. */}

      {/* Photo region — the full 4:5 editing surface */}
      <div
        ref={regionRef}
        className="absolute inset-0 overflow-hidden"
        style={{
          background: brand.colors.primary,
          cursor: dragRef.current.active ? "grabbing" : "grab",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onWheel={onWheel}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          className="absolute pointer-events-none"
          style={{
            left: photoDomLeft,
            top: photoDomTop,
            width: photoDomW,
            height: photoDomH,
            // Tailwind's preflight applies max-width: 100% to all <img>; without
            // overriding, photoDomW > regionDomW gets clamped to region width
            // while photoDomH stays unclamped, breaking aspect ratio when zoomed
            // past 1.0×. The parent has overflow-hidden so any overflow is
            // already correctly clipped to the editing region.
            maxWidth: "none",
            maxHeight: "none",
            opacity: imgDims ? 1 : 0,
          }}
        />

        {/* Minimap: thumbnail of the full photo with a viewport rectangle
            showing what's currently in the 4:5 crop. Top-left so it doesn't
            collide with the controls panel along the bottom. */}
        {imgDims && minimapW > 0 && (
          <div
            className="absolute top-2 left-2 pointer-events-none rounded overflow-hidden border border-white/40 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.5)]"
            style={{ width: minimapW, height: minimapH, opacity: 0.85 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt=""
              className="w-full h-full object-fill"
              draggable={false}
            />
            <div
              className="absolute border-2 border-emerald-400 bg-emerald-400/15"
              style={{
                left: `${viewportLeftPct}%`,
                top: `${viewportTopPct}%`,
                width: `${viewportWPct}%`,
                height: `${viewportHPct}%`,
              }}
            />
          </div>
        )}

        {/* Center crosshair: visible while a snap is active */}
        {snapHint && (
          <div className="absolute inset-0 pointer-events-none">
            {(snapHint === "x" || snapHint === "both") && (
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/85 mix-blend-difference" />
            )}
            {(snapHint === "y" || snapHint === "both") && (
              <div className="absolute left-0 right-0 top-1/2 h-px bg-white/85 mix-blend-difference" />
            )}
          </div>
        )}
      </div>

      {/* Controls panel sits over the bottom of the photo */}
      <div className="absolute inset-x-0 bottom-0 z-20 p-2.5 bg-black/85 backdrop-blur-sm flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-white/60 w-9">Zoom</span>
          {/* Slider with a tick at 1.0× (cover-fit) so the user can see the
              reference point for "no crop beyond what aspect-ratio mismatch
              already forces". (1.0 - 0.3) / (3.0 - 0.3) = 25.93%. */}
          <div className="relative flex-1 flex items-center">
            <div
              className="absolute top-1/2 w-px h-3 bg-white/60 -translate-y-1/2 pointer-events-none"
              style={{ left: "25.93%" }}
              title="1.0× (cover-fit)"
            />
            <input
              type="range"
              min={0.3}
              max={3.0}
              step={0.05}
              value={framing.scale}
              onChange={(e) =>
                setFraming((f) => ({ ...f, scale: parseFloat(e.target.value) }))
              }
              className="w-full accent-white"
            />
          </div>
          <span className="text-[10px] text-white tabular-nums w-12 text-right">
            {framing.scale.toFixed(2)}×
          </span>
        </div>
        <div className="flex justify-between items-center">
          <button
            onClick={() => setFraming({ x: 0, y: 0, scale: 1.0 })}
            className="text-[10px] text-white/70 hover:text-white underline-offset-2 hover:underline"
          >
            reset
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={onCancel}
              className="px-3.5 py-1.5 rounded-full text-xs font-medium bg-white/15 text-white hover:bg-white/25"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(framing)}
              className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white text-neutral-900 hover:bg-neutral-200"
            >
              Done
            </button>
          </div>
        </div>
      </div>
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
