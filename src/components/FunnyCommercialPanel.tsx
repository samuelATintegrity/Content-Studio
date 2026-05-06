"use client";

// Funny Commercial — main-body picker UI.
//
// Three scene sections stack vertically in the main work area: Scene 1
// (absurd opener clips), Scene 2 (actor + text overlay), Scene 3 (CTA
// text). Each library renders as a horizontal scrollable thumbnail
// row inline — no modals, no sidebar nesting. The Generate FAB
// remains the trigger for the final render.

import { useEffect, useRef, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  addFcScene1Image,
  addFcScene1Video,
  addFcScene2Actor,
  addFcScene2Phrase,
  addFcScene3Phrase,
  listFcScene1Images,
  listFcScene1Videos,
  listFcScene2Actors,
  listFcScene2Phrases,
  listFcScene3Phrases,
  removeFcScene1Image,
  removeFcScene1Video,
  removeFcScene2Actor,
  removeFcScene2Phrase,
  removeFcScene3Phrase,
  subscribeFcScene1Images,
  subscribeFcScene1Videos,
  subscribeFcScene2Actors,
  subscribeFcScene2Phrases,
  subscribeFcScene3Phrases,
} from "@/lib/funnyCommercialLibrary";
import {
  fcAnimateImage,
  fcGenerateScene1Image,
  fcGenerateScene2ActorImage,
  fcPickScene1,
  fcUploadScene2Actor,
} from "@/lib/funnyCommercial";
import type {
  FcSceneImage,
  FcSceneVideo,
  FcPhrase,
  FcTranslatedPhrase,
  Language,
} from "@/lib/types";
import { LANGUAGE_LABELS } from "@/lib/types";

export function FunnyCommercialPanel() {
  return (
    <div className="flex flex-col gap-10 max-w-[1400px] mx-auto">
      <Header />
      <Scene1Block />
      <Scene2ActorBlock />
      <Scene2TextBlock />
      <Scene3CtaBlock />
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-xl font-semibold tracking-tight">Funny commercial</h1>
      <p className="text-[13px] text-neutral-500 leading-relaxed max-w-2xl">
        A 4-scene comedic ad: an absurd opener, a person hearing it through the wall, your CTA, then the logo. Pick a clip for each scene, write the text overlays, then hit{" "}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">Render commercial</span>.
      </p>
    </div>
  );
}

function SectionShell({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-neutral-200 dark:border-neutral-900 bg-white dark:bg-neutral-950 p-5 sm:p-6">
      <header className="flex items-baseline gap-3">
        <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 font-semibold tabular-nums">
          {number}
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="text-[12px] text-neutral-500 leading-snug mt-0.5">
              {description}
            </p>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 transition disabled:opacity-60 whitespace-nowrap"
    >
      {children}
    </button>
  );
}

function GhostButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3.5 py-2 rounded-full text-[12px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition disabled:opacity-60 whitespace-nowrap"
    >
      {children}
    </button>
  );
}

function DeleteIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 px-4 py-8 text-center text-[12px] text-neutral-500 leading-snug">
      {children}
    </div>
  );
}

// Horizontal scrolling row of thumbnail tiles. Each tile is the same
// 9:16 aspect (160x284 baseline so a row of them on a wide screen
// shows ~6-7 at once) with a hover-to-delete affordance and a
// click-to-select primary action.
function ThumbnailRow({
  items,
  selectedId,
  onSelect,
  onDelete,
  renderMedia,
  renderMeta,
  emptyText,
  rightSlot,
}: {
  items: { id: string; key: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  renderMedia: (id: string) => React.ReactNode;
  renderMeta: (id: string) => React.ReactNode;
  emptyText: string;
  rightSlot?: (id: string) => React.ReactNode;
}) {
  if (items.length === 0) {
    return <EmptyHint>{emptyText}</EmptyHint>;
  }
  return (
    <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 snap-x snap-mandatory">
      {items.map((it) => {
        const selected = selectedId === it.id;
        return (
          <div
            key={it.key}
            className={`group relative shrink-0 w-[170px] rounded-2xl overflow-hidden border transition snap-start ${
              selected
                ? "border-neutral-900 dark:border-white ring-2 ring-neutral-900 dark:ring-white"
                : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(it.id)}
              className="block w-full aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative"
              title={selected ? "Selected" : "Use this clip"}
            >
              {renderMedia(it.id)}
              <div
                className={`absolute inset-0 flex items-center justify-center text-white text-[10px] font-bold tracking-widest transition ${
                  selected
                    ? "bg-black/20"
                    : "bg-black/0 hover:bg-black/30 opacity-0 hover:opacity-100"
                }`}
              >
                {selected ? "SELECTED" : "USE"}
              </div>
            </button>
            <button
              type="button"
              onClick={() => onDelete(it.id)}
              className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
              title="Delete"
            >
              <DeleteIcon />
            </button>
            <div className="px-2 py-1.5 bg-white dark:bg-neutral-950 flex items-center justify-between gap-1">
              <div className="min-w-0 flex-1">{renderMeta(it.id)}</div>
              {rightSlot?.(it.id)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Scene 1 ────────────────────────────────────────────────────────

// Generic high-energy fallback for source images that don't carry a
// Claude-authored animationPrompt (e.g. images generated before the
// animationPrompt field landed). Beats the real-estate "subtle push-in"
// default the legacy animate route falls back to.
const FC_DEFAULT_ANIMATION_PROMPT =
  "the subject moves with high-energy motion throughout the shot, fast-paced and dynamic, full kinetic action, camera holds steady to let the chaos play out";

function Scene1Block() {
  const [videos, setVideos] = useState<FcSceneVideo[]>(() => listFcScene1Videos());
  const [images, setImages] = useState<FcSceneImage[]>(() => listFcScene1Images());
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState<null | "generating" | "animating">(null);
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  // Per-image draft animation prompts. Pre-filled from the image's
  // saved animationPrompt (or the FC default for legacy images);
  // editable inline before clicking Animate so the user can punch it
  // up if Claude's direction wasn't aggressive enough.
  const [animDrafts, setAnimDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const fcSelectedScene1VideoId = useBatchStore((s) => s.fcSelectedScene1VideoId);
  const setFcSelectedScene1VideoId = useBatchStore((s) => s.setFcSelectedScene1VideoId);

  useEffect(() => subscribeFcScene1Videos(() => setVideos(listFcScene1Videos())), []);
  useEffect(() => subscribeFcScene1Images(() => setImages(listFcScene1Images())), []);

  function animDraftFor(image: FcSceneImage): string {
    return (
      animDrafts[image.id] ??
      image.animationPrompt ??
      FC_DEFAULT_ANIMATION_PROMPT
    );
  }

  async function generateNew() {
    if (busy) return;
    setError(null);
    setBusy("generating");
    try {
      const pick = await fcPickScene1(hint.trim() || undefined);
      const { url } = await fcGenerateScene1Image(pick.imagePrompt);
      addFcScene1Image({
        url,
        imagePrompt: pick.imagePrompt,
        animationPrompt: pick.animationPrompt,
        themeKey: pick.themeKey,
        conceptKey: pick.conceptKey,
      });
      setHint("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setBusy(null);
    }
  }

  async function animate(image: FcSceneImage) {
    if (busy) return;
    setError(null);
    setBusy("animating");
    setAnimatingId(image.id);
    const animationPrompt = animDraftFor(image).trim();
    try {
      const { url } = await fcAnimateImage({
        imageUrl: image.url,
        animationPrompt: animationPrompt || undefined,
      });
      const fresh = addFcScene1Video({
        url,
        sourceImageId: image.id,
        imagePrompt: image.imagePrompt,
        themeKey: image.themeKey,
        conceptKey: image.conceptKey,
        source: "ai",
      });
      // Auto-select the freshly animated clip for this batch.
      setFcSelectedScene1VideoId(fresh.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "animate failed");
    } finally {
      setBusy(null);
      setAnimatingId(null);
    }
  }

  function deleteVideo(id: string) {
    if (!window.confirm("Delete this Scene 1 clip?")) return;
    if (fcSelectedScene1VideoId === id) setFcSelectedScene1VideoId(null);
    removeFcScene1Video(id);
  }

  function deleteImage(id: string) {
    if (!window.confirm("Delete this source image?")) return;
    removeFcScene1Image(id);
  }

  return (
    <SectionShell
      number="Scene 1"
      title="Absurd opener"
      description="The loud setup — what the neighbor hears through the wall. Generate an idea, then animate the image to a clip."
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          placeholder="Optional hint (e.g. 'an animal that plays an instrument')"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          disabled={busy === "generating"}
          className="flex-1 px-3 py-2 rounded-2xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 disabled:opacity-60"
        />
        <PrimaryButton onClick={generateNew} disabled={!!busy}>
          {busy === "generating" ? "Generating idea + image…" : "Generate new image"}
        </PrimaryButton>
      </div>
      {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}

      <div className="flex flex-col gap-3">
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Animated clips ({videos.length}) — pick one for the ad
        </h3>
        <ThumbnailRow
          items={videos.map((v) => ({ id: v.id, key: v.id }))}
          selectedId={fcSelectedScene1VideoId}
          onSelect={(id) => setFcSelectedScene1VideoId(id)}
          onDelete={deleteVideo}
          emptyText="No clips yet. Generate an image below, then click Animate."
          renderMedia={(id) => {
            const v = videos.find((x) => x.id === id)!;
            return (
              <video src={v.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
            );
          }}
          renderMeta={(id) => {
            const v = videos.find((x) => x.id === id)!;
            return (
              <div className="text-[9px] uppercase tracking-[0.1em] text-neutral-500 truncate" title={v.themeKey ?? undefined}>
                {v.themeKey ?? "clip"}
              </div>
            );
          }}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Source images ({images.length}) — edit the animation prompt, then animate
        </h3>
        {images.length === 0 ? (
          <EmptyHint>No source images yet. Click Generate above.</EmptyHint>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {images.map((img) => (
              <div
                key={img.id}
                className="group relative rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600 transition flex flex-col"
              >
                <div className="aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => deleteImage(img.id)}
                    className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
                    title="Delete"
                  >
                    <DeleteIcon />
                  </button>
                  {img.themeKey && (
                    <span className="absolute bottom-1.5 left-1.5 text-[9px] uppercase tracking-[0.12em] text-white bg-black/60 px-2 py-0.5 rounded-full">
                      {img.themeKey}
                    </span>
                  )}
                </div>
                <div className="p-2.5 flex flex-col gap-2 bg-white dark:bg-neutral-950">
                  <label className="text-[9px] uppercase tracking-[0.12em] text-neutral-500 font-semibold">
                    Animation prompt
                  </label>
                  <textarea
                    value={animDraftFor(img)}
                    onChange={(e) =>
                      setAnimDrafts((d) => ({ ...d, [img.id]: e.target.value }))
                    }
                    rows={3}
                    disabled={!!busy}
                    className="w-full px-2 py-1.5 rounded-xl text-[11px] leading-snug border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none disabled:opacity-60"
                    placeholder={FC_DEFAULT_ANIMATION_PROMPT}
                  />
                  <button
                    type="button"
                    onClick={() => animate(img)}
                    disabled={!!busy}
                    className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60 self-start"
                  >
                    {animatingId === img.id ? "Animating…" : "Animate"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionShell>
  );
}

// ── Scene 2 actor ──────────────────────────────────────────────────

function Scene2ActorBlock() {
  const [actors, setActors] = useState<FcSceneVideo[]>(() => listFcScene2Actors());
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState<null | "uploading" | "generating" | "animating">(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fcSelectedScene2ActorId = useBatchStore((s) => s.fcSelectedScene2ActorId);
  const setFcSelectedScene2ActorId = useBatchStore((s) => s.setFcSelectedScene2ActorId);

  useEffect(() => subscribeFcScene2Actors(() => setActors(listFcScene2Actors())), []);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy("uploading");
    try {
      const { cachedUrl, filename } = await fcUploadScene2Actor(file);
      const fresh = addFcScene2Actor({ url: cachedUrl, filename, source: "upload" });
      setFcSelectedScene2ActorId(fresh.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function generateActor() {
    if (busy) return;
    setError(null);
    setBusy("generating");
    try {
      const { url: imageUrl, prompt } = await fcGenerateScene2ActorImage(hint.trim() || undefined);
      setBusy("animating");
      const { url: videoUrl } = await fcAnimateImage({ imageUrl });
      const fresh = addFcScene2Actor({ url: videoUrl, imagePrompt: prompt, source: "ai" });
      setFcSelectedScene2ActorId(fresh.id);
      setHint("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "generate failed");
    } finally {
      setBusy(null);
    }
  }

  function deleteActor(id: string) {
    if (!window.confirm("Delete this actor clip?")) return;
    if (fcSelectedScene2ActorId === id) setFcSelectedScene2ActorId(null);
    removeFcScene2Actor(id);
  }

  return (
    <SectionShell
      number="Scene 2"
      title="Actor in bed"
      description="A person lying awake at night, hearing the noise. Upload your own clip or generate one."
    >
      <div className="flex flex-col sm:flex-row gap-2">
        <PrimaryButton
          onClick={() => !busy && inputRef.current?.click()}
          disabled={!!busy}
        >
          {busy === "uploading" ? "Uploading…" : "Upload mp4"}
        </PrimaryButton>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/*"
          onChange={onPick}
          className="hidden"
        />
        <input
          type="text"
          placeholder="Demographic hint (e.g. 'woman in her 30s')"
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          disabled={!!busy}
          className="flex-1 px-3 py-2 rounded-2xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 disabled:opacity-60"
        />
        <PrimaryButton onClick={generateActor} disabled={!!busy}>
          {busy === "generating"
            ? "Image…"
            : busy === "animating"
              ? "Animating…"
              : "Generate actor"}
        </PrimaryButton>
      </div>
      {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}

      <div className="flex flex-col gap-3">
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Actor library ({actors.length}) — pick one for the ad
        </h3>
        <ThumbnailRow
          items={actors.map((a) => ({ id: a.id, key: a.id }))}
          selectedId={fcSelectedScene2ActorId}
          onSelect={(id) => setFcSelectedScene2ActorId(id)}
          onDelete={deleteActor}
          emptyText="No actors yet. Upload or generate above."
          renderMedia={(id) => {
            const a = actors.find((x) => x.id === id)!;
            return (
              <video src={a.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
            );
          }}
          renderMeta={(id) => {
            const a = actors.find((x) => x.id === id)!;
            return (
              <div className="text-[9px] uppercase tracking-[0.1em] text-neutral-500 truncate">
                {a.source === "upload" ? "uploaded" : "ai"}
              </div>
            );
          }}
        />
      </div>
    </SectionShell>
  );
}

// ── Scene 2 text overlay ───────────────────────────────────────────

function Scene2TextBlock() {
  const language = useBatchStore((s) => s.language);
  const fcScene2Text = useBatchStore((s) => s.fcScene2Text);
  const setFcScene2Text = useBatchStore((s) => s.setFcScene2Text);
  const [phrases, setPhrases] = useState<FcPhrase[]>(() => listFcScene2Phrases(language));
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => subscribeFcScene2Phrases(() => setPhrases(listFcScene2Phrases(language))),
    [language],
  );

  function saveCurrent() {
    const text = fcScene2Text.trim();
    if (!text) {
      setError("Type something first.");
      return;
    }
    try {
      addFcScene2Phrase({ text, language });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  function deletePhrase(p: FcPhrase) {
    if (!window.confirm(`Delete "${p.text}"?`)) return;
    removeFcScene2Phrase(p.id);
  }

  return (
    <SectionShell
      number="Scene 2"
      title="Text overlay"
      description={`Burns into the bottom of the actor clip. Saved phrases are language-tagged (${LANGUAGE_LABELS[language]}).`}
    >
      <textarea
        value={fcScene2Text}
        onChange={(e) => setFcScene2Text(e.target.value)}
        rows={2}
        placeholder="Time to buy your own place?"
        className="w-full px-3 py-2 rounded-2xl text-[14px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
      />
      <div className="flex items-center gap-2">
        <GhostButton onClick={saveCurrent} disabled={!fcScene2Text.trim()}>
          Save to library
        </GhostButton>
        {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Saved phrases ({phrases.length})
        </h3>
        {phrases.length === 0 ? (
          <EmptyHint>No saved phrases yet for {LANGUAGE_LABELS[language]}.</EmptyHint>
        ) : (
          <div className="flex flex-wrap gap-2">
            {phrases.map((p) => (
              <div
                key={p.id}
                className="group flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
              >
                <button
                  type="button"
                  onClick={() => setFcScene2Text(p.text)}
                  className="text-[12px] leading-snug text-left"
                  title="Use this phrase"
                >
                  {p.text}
                </button>
                <button
                  type="button"
                  onClick={() => deletePhrase(p)}
                  className="text-neutral-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                  title="Delete"
                >
                  <DeleteIcon />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionShell>
  );
}

// ── Scene 3 CTA ────────────────────────────────────────────────────

function Scene3CtaBlock() {
  const language = useBatchStore((s) => s.language);
  const fcScene3Text = useBatchStore((s) => s.fcScene3Text);
  const fcScene3PhraseId = useBatchStore((s) => s.fcScene3PhraseId);
  const setFcScene3Text = useBatchStore((s) => s.setFcScene3Text);
  const setFcScene3PhraseId = useBatchStore((s) => s.setFcScene3PhraseId);
  const [phrases, setPhrases] = useState<FcTranslatedPhrase[]>(() => listFcScene3Phrases());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFcScene3Phrases(() => setPhrases(listFcScene3Phrases())), []);

  function onTextChange(value: string) {
    setFcScene3Text(value);
    if (fcScene3PhraseId) setFcScene3PhraseId(null);
  }

  function saveCurrent() {
    const text = fcScene3Text.trim();
    if (!text) {
      setError("Type something first.");
      return;
    }
    try {
      addFcScene3Phrase(text);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  function pick(p: FcTranslatedPhrase) {
    setFcScene3PhraseId(p.id);
    setFcScene3Text(p.en);
  }

  function deletePhrase(p: FcTranslatedPhrase) {
    if (!window.confirm(`Delete "${p.en}"?`)) return;
    if (fcScene3PhraseId === p.id) setFcScene3PhraseId(null);
    removeFcScene3Phrase(p.id);
  }

  function badge(p: FcTranslatedPhrase, lang: Exclude<Language, "en">) {
    return p[lang] ? "✓" : "—";
  }

  return (
    <SectionShell
      number="Scene 3"
      title="CTA (auto-translates)"
      description={`Author in English; we translate to ${LANGUAGE_LABELS[language]} at render time and cache the result.`}
    >
      <textarea
        value={fcScene3Text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={3}
        placeholder="Start by connecting with a top-tier agent at Agent Match."
        className="w-full px-3 py-2 rounded-2xl text-[14px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
      />
      <div className="flex items-center gap-2">
        <GhostButton onClick={saveCurrent} disabled={!fcScene3Text.trim()}>
          Save to library
        </GhostButton>
        {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Saved CTAs ({phrases.length})
        </h3>
        {phrases.length === 0 ? (
          <EmptyHint>No saved CTAs yet.</EmptyHint>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {phrases.map((p) => (
              <li
                key={p.id}
                className={`group flex items-start gap-2 px-3 py-2 rounded-2xl border transition ${
                  fcScene3PhraseId === p.id
                    ? "border-neutral-900 dark:border-white"
                    : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                }`}
              >
                <button
                  type="button"
                  onClick={() => pick(p)}
                  className="flex-1 text-left flex flex-col gap-1 min-w-0"
                  title="Use this CTA"
                >
                  <span className="text-[12px] leading-snug">{p.en}</span>
                  <span className="text-[10px] text-neutral-500 tabular-nums">
                    Cached: TL {badge(p, "tl")} · ES {badge(p, "es")} · ZH {badge(p, "zh")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deletePhrase(p)}
                  className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition"
                  title="Delete"
                >
                  <DeleteIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionShell>
  );
}
