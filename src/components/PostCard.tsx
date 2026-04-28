"use client";

import { useEffect, useRef, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import type { FitMode, FontVariant, Framing, Post, StyleVariant } from "@/lib/types";
import { STYLE_LABELS } from "@/lib/types";
import { brand } from "../../brand.config";
import {
  composeImageDataUrl,
  dataUrlToBlob,
  fetchAiImage,
  fetchOneCopy,
  fetchPhotoFor,
} from "@/lib/client";
import { AI_CREDIT_LABEL, randomPrompt } from "@/lib/imagePrompts";
import { EditTextModal } from "./EditTextModal";

type RecomposeOverrides = Partial<{
  headline: string;
  cta: string;
  fontVariant: FontVariant;
  framing: Post["framing"];
  fitMode: FitMode;
  style: StyleVariant;
}>;

export function PostCard({ post }: { post: Post }) {
  const { language, contentType, updatePost, usedPhotoIds, addUsedPhotoId } = useBatchStore();
  const [busy, setBusy] = useState<null | "photo" | "copy" | "tweak" | "ai">(null);
  const [editing, setEditing] = useState(false);
  const [captionCopied, setCaptionCopied] = useState(false);
  const [imageDownloaded, setImageDownloaded] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [editingPhoto, setEditingPhoto] = useState(false);

  async function recompose(overrides: RecomposeOverrides = {}) {
    if (!post.photoUrl) return;
    return composeImageDataUrl({
      photoUrl: post.photoUrl,
      headline: overrides.headline ?? post.headline,
      cta: overrides.cta ?? post.cta,
      fontVariant: overrides.fontVariant ?? post.fontVariant,
      framing: overrides.framing ?? post.framing,
      fitMode: overrides.fitMode ?? post.fitMode,
      style: overrides.style ?? post.style,
    });
  }

  async function regenImage() {
    setBusy("photo");
    try {
      const photo = await fetchPhotoFor(contentType, usedPhotoIds);
      addUsedPhotoId(photo.id);
      const imageDataUrl = await composeImageDataUrl({
        photoUrl: photo.url,
        headline: post.headline,
        cta: post.cta,
        fontVariant: post.fontVariant,
        framing: post.framing,
        fitMode: post.fitMode,
        style: post.style,
      });
      updatePost(post.id, {
        photoUrl: photo.url,
        photoCredit: { photographer: photo.photographer, sourceUrl: photo.sourceUrl },
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
      const ai = await fetchAiImage(prompt);
      const imageDataUrl = await composeImageDataUrl({
        photoUrl: ai.url,
        headline: post.headline,
        cta: post.cta,
        fontVariant: post.fontVariant,
        framing: post.framing,
        fitMode: post.fitMode,
        style: post.style,
      });
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

  async function toggleFont() {
    if (!post.photoUrl) return;
    const next: FontVariant = post.fontVariant === "sans" ? "serif" : "sans";
    setBusy("tweak");
    try {
      const imageDataUrl = await recompose({ fontVariant: next });
      updatePost(post.id, { fontVariant: next, imageDataUrl });
    } catch (e) {
      alert("Font swap failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(null);
    }
  }

  async function cycleStyle() {
    if (!post.photoUrl) return;
    const order: StyleVariant[] = ["branded", "light", "sepia", "plain"];
    const idx = order.indexOf(post.style);
    const next = order[(idx + 1) % order.length];
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

  async function toggleFitMode() {
    if (!post.photoUrl) return;
    const next: FitMode = post.fitMode === "cover" ? "contain" : "cover";
    setBusy("tweak");
    try {
      const imageDataUrl = await recompose({ fitMode: next });
      updatePost(post.id, { fitMode: next, imageDataUrl });
    } catch (e) {
      alert("Fit toggle failed: " + (e instanceof Error ? e.message : "unknown"));
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

  const fontLabel = post.fontVariant === "serif" ? "Serif" : "Sans";
  const fitLabel = post.fitMode === "contain" ? "Fit" : "Fill";

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
            <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover/image:opacity-100 transition focus-within:opacity-100">
              <button
                onClick={() => setEditingPhoto(true)}
                disabled={!post.photoUrl}
                className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-black/70 text-white backdrop-blur-md hover:bg-black/85 disabled:opacity-40"
                title="Zoom and reposition the photo"
              >
                Edit
              </button>
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
          <div className="flex gap-1 shrink-0 text-[10px] uppercase tracking-[0.1em] text-neutral-500">
            <Chip onClick={cycleStyle} disabled={busy !== null || !post.photoUrl} title="Cycle visual style">
              {STYLE_LABELS[post.style]}
            </Chip>
            <Chip onClick={toggleFitMode} disabled={busy !== null || !post.photoUrl} title="Toggle Fit / Fill">
              {fitLabel}
            </Chip>
            <Chip onClick={toggleFont} disabled={busy !== null || !post.photoUrl} title="Swap headline font">
              Aa · {fontLabel}
            </Chip>
          </div>
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
            className="absolute top-0 right-0 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-neutral-900/90 dark:bg-neutral-100 text-white dark:text-neutral-900 backdrop-blur-md opacity-0 group-hover/caption:opacity-100 transition focus:opacity-100"
            title="Copy caption to clipboard"
          >
            {captionCopied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* AI image prompt — generates via Nano Banana 2 and replaces the photo.
            Input is full-width on its own row so long prompts stay readable;
            shuffle + generate sit underneath. */}
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

        <div className="flex flex-wrap gap-1.5 pt-1">
          <BtnSmall onClick={regenImage} disabled={busy !== null}>
            {busy === "photo" ? "…" : "New image"}
          </BtnSmall>
          <BtnSmall onClick={regenCopy} disabled={busy !== null}>
            {busy === "copy" ? "…" : "New caption"}
          </BtnSmall>
          <BtnSmall onClick={() => setEditing(true)}>Edit text</BtnSmall>
        </div>

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
            opacity: imgDims ? 1 : 0,
            transition: dragRef.current.active
              ? "none"
              : "left 0.08s linear, top 0.08s linear, width 0.08s linear, height 0.08s linear",
          }}
        />

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
          <input
            type="range"
            min={0.3}
            max={3.0}
            step={0.05}
            value={framing.scale}
            onChange={(e) =>
              setFraming((f) => ({ ...f, scale: parseFloat(e.target.value) }))
            }
            className="flex-1 accent-white"
          />
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
