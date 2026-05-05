"use client";

// All four Funny Commercial library modals live in one file so they can
// share the small modal-shell + thumbnail-row helpers without bloating
// the components tree. Each one mirrors the MusicLibraryModal shape
// (header + body + scrollable list) and writes back to the shared
// libraryStore via funnyCommercialLibrary helpers.

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
import type { FcSceneImage, FcSceneVideo, FcPhrase, FcTranslatedPhrase, Language } from "@/lib/types";
import { LANGUAGE_LABELS } from "@/lib/types";

// ── Shared modal shell ──────────────────────────────────────────────

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-neutral-950 rounded-3xl border border-neutral-200 dark:border-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-900 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-neutral-500 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="p-5 flex flex-col gap-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
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
      className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 transition disabled:opacity-60"
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
      className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function DeleteIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── Scene 1 modal ──────────────────────────────────────────────────
//
// Two collapsible sections:
//   1. Videos library — finished animated Scene 1 clips. Click to
//      select for the current batch.
//   2. Images library — generated source images that can be animated.
//      "Animate" sends the image to Seedance; the resulting clip drops
//      into the Videos library.
// "Generate new" runs Claude → Nano → image lands in Images library.

export function Scene1LibraryModal({ onClose }: { onClose: () => void }) {
  const [images, setImages] = useState<FcSceneImage[]>(() => listFcScene1Images());
  const [videos, setVideos] = useState<FcSceneVideo[]>(() => listFcScene1Videos());
  const [tab, setTab] = useState<"videos" | "images">("videos");
  const [busy, setBusy] = useState<null | "generating" | "animating">(null);
  const [animatingImageId, setAnimatingImageId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fcSelectedScene1VideoId = useBatchStore((s) => s.fcSelectedScene1VideoId);
  const setFcSelectedScene1VideoId = useBatchStore((s) => s.setFcSelectedScene1VideoId);

  useEffect(() => subscribeFcScene1Images(() => setImages(listFcScene1Images())), []);
  useEffect(() => subscribeFcScene1Videos(() => setVideos(listFcScene1Videos())), []);

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
        themeKey: pick.themeKey,
        conceptKey: pick.conceptKey,
      });
      setHint("");
      setTab("images");
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
    setAnimatingImageId(image.id);
    try {
      const { url } = await fcAnimateImage({ imageUrl: image.url });
      addFcScene1Video({
        url,
        sourceImageId: image.id,
        imagePrompt: image.imagePrompt,
        themeKey: image.themeKey,
        conceptKey: image.conceptKey,
        source: "ai",
      });
      setTab("videos");
    } catch (e) {
      setError(e instanceof Error ? e.message : "animate failed");
    } finally {
      setBusy(null);
      setAnimatingImageId(null);
    }
  }

  function selectVideo(video: FcSceneVideo) {
    setFcSelectedScene1VideoId(video.id);
    onClose();
  }

  function deleteVideo(video: FcSceneVideo) {
    if (!window.confirm("Delete this Scene 1 video from your library?")) return;
    if (fcSelectedScene1VideoId === video.id) setFcSelectedScene1VideoId(null);
    removeFcScene1Video(video.id);
  }

  function deleteImage(image: FcSceneImage) {
    if (!window.confirm("Delete this Scene 1 source image?")) return;
    removeFcScene1Image(image.id);
  }

  return (
    <ModalShell
      title="Scene 1 library"
      subtitle="The absurd opening scene. Pick one — or generate fresh."
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Generate new
        </label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Optional hint (e.g. 'an animal that plays an instrument')"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            disabled={busy === "generating"}
            className="flex-1 px-3 py-2 rounded-2xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 disabled:opacity-60"
          />
          <PrimaryButton onClick={generateNew} disabled={!!busy}>
            {busy === "generating" ? "Generating…" : "Generate"}
          </PrimaryButton>
        </div>
        <p className="text-[10px] text-neutral-500 leading-snug">
          Claude picks an idea + writes a Nano Banana prompt; we generate the source image. Animate it in the Images tab.
        </p>
      </div>

      <div className="flex gap-2 mt-2 border-b border-neutral-200 dark:border-neutral-900 -mb-2">
        <TabButton active={tab === "videos"} onClick={() => setTab("videos")}>
          Videos ({videos.length})
        </TabButton>
        <TabButton active={tab === "images"} onClick={() => setTab("images")}>
          Images ({images.length})
        </TabButton>
      </div>

      {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}

      {tab === "videos" ? (
        videos.length === 0 ? (
          <EmptyState>No animated Scene 1 clips yet. Generate an image then animate it.</EmptyState>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {videos.map((v) => (
              <ThumbCard
                key={v.id}
                selected={fcSelectedScene1VideoId === v.id}
                onSelect={() => selectVideo(v)}
                onDelete={() => deleteVideo(v)}
                badge={v.themeKey}
                kind="video"
                url={v.url}
                title={v.imagePrompt ?? "Scene 1 clip"}
                meta={new Date(v.savedAt).toLocaleDateString()}
              />
            ))}
          </div>
        )
      ) : images.length === 0 ? (
        <EmptyState>No source images yet. Click Generate above.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {images.map((img) => (
            <ThumbCard
              key={img.id}
              onDelete={() => deleteImage(img)}
              badge={img.themeKey}
              kind="image"
              url={img.url}
              title={img.imagePrompt}
              meta={new Date(img.savedAt).toLocaleDateString()}
              actionSlot={
                <GhostButton
                  onClick={() => animate(img)}
                  disabled={!!busy}
                >
                  {animatingImageId === img.id ? "Animating…" : "Animate"}
                </GhostButton>
              }
            />
          ))}
        </div>
      )}
    </ModalShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-[12px] font-medium border-b-2 transition ${
        active
          ? "border-neutral-900 dark:border-white text-neutral-900 dark:text-white"
          : "border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] text-neutral-500 leading-snug py-6 text-center">
      {children}
    </p>
  );
}

// Thumbnail tile — used in Scene 1 (images + videos) and Scene 2 actor lists.
function ThumbCard({
  selected,
  onSelect,
  onDelete,
  badge,
  kind,
  url,
  title,
  meta,
  actionSlot,
}: {
  selected?: boolean;
  onSelect?: () => void;
  onDelete: () => void;
  badge?: string;
  kind: "image" | "video";
  url: string;
  title: string;
  meta: string;
  actionSlot?: React.ReactNode;
}) {
  return (
    <div
      className={`group relative rounded-2xl overflow-hidden border transition ${
        selected
          ? "border-neutral-900 dark:border-white ring-2 ring-neutral-900 dark:ring-white"
          : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
      }`}
    >
      <div className="aspect-[9/16] bg-neutral-100 dark:bg-neutral-900 relative">
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <video src={url} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        )}
        {onSelect && (
          <button
            onClick={onSelect}
            className="absolute inset-0 bg-black/0 hover:bg-black/30 transition flex items-center justify-center text-white text-[11px] font-semibold opacity-0 hover:opacity-100"
            title="Use this clip"
          >
            {selected ? "SELECTED" : "USE"}
          </button>
        )}
        <button
          onClick={onDelete}
          className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
          title="Delete"
        >
          <DeleteIcon />
        </button>
      </div>
      <div className="px-2.5 py-2 flex flex-col gap-0.5 bg-white dark:bg-neutral-950">
        {badge && (
          <span className="text-[9px] uppercase tracking-[0.12em] text-neutral-500 truncate">
            {badge}
          </span>
        )}
        <p className="text-[10px] text-neutral-500 leading-snug line-clamp-2" title={title}>
          {title}
        </p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-neutral-400 tabular-nums">{meta}</span>
          {actionSlot}
        </div>
      </div>
    </div>
  );
}

// ── Scene 2 actor modal ────────────────────────────────────────────

export function Scene2ActorLibraryModal({ onClose }: { onClose: () => void }) {
  const [actors, setActors] = useState<FcSceneVideo[]>(() => listFcScene2Actors());
  const [busy, setBusy] = useState<null | "uploading" | "generating" | "animating">(null);
  const [hint, setHint] = useState("");
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
      addFcScene2Actor({ url: cachedUrl, filename, source: "upload" });
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
      addFcScene2Actor({
        url: videoUrl,
        imagePrompt: prompt,
        source: "ai",
      });
      setHint("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "generate failed");
    } finally {
      setBusy(null);
    }
  }

  function selectActor(actor: FcSceneVideo) {
    setFcSelectedScene2ActorId(actor.id);
    onClose();
  }

  function deleteActor(actor: FcSceneVideo) {
    if (!window.confirm("Delete this actor clip?")) return;
    if (fcSelectedScene2ActorId === actor.id) setFcSelectedScene2ActorId(null);
    removeFcScene2Actor(actor.id);
  }

  return (
    <ModalShell
      title="Scene 2 actors"
      subtitle="Person lying in bed. Upload your own clip or generate one."
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Add actor
        </label>
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
                : "Generate"}
          </PrimaryButton>
        </div>
      </div>

      {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}

      {actors.length === 0 ? (
        <EmptyState>No actors yet. Upload an mp4 or generate one above.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {actors.map((a) => (
            <ThumbCard
              key={a.id}
              selected={fcSelectedScene2ActorId === a.id}
              onSelect={() => selectActor(a)}
              onDelete={() => deleteActor(a)}
              badge={a.source === "upload" ? "uploaded" : "ai"}
              kind="video"
              url={a.url}
              title={a.filename ?? a.imagePrompt ?? "Actor clip"}
              meta={new Date(a.savedAt).toLocaleDateString()}
            />
          ))}
        </div>
      )}
    </ModalShell>
  );
}

// ── Scene 2 phrase modal ───────────────────────────────────────────

export function Scene2PhraseLibraryModal({ onClose }: { onClose: () => void }) {
  const language = useBatchStore((s) => s.language);
  const fcScene2Text = useBatchStore((s) => s.fcScene2Text);
  const setFcScene2Text = useBatchStore((s) => s.setFcScene2Text);
  const [phrases, setPhrases] = useState<FcPhrase[]>(() => listFcScene2Phrases(language));
  const [draft, setDraft] = useState<string>(fcScene2Text);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFcScene2Phrases(() => setPhrases(listFcScene2Phrases(language))), [language]);

  function saveDraft() {
    const text = draft.trim();
    if (!text) {
      setError("Enter some text first.");
      return;
    }
    try {
      addFcScene2Phrase({ text, language });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  function useDraft() {
    setFcScene2Text(draft);
    onClose();
  }

  function pick(phrase: FcPhrase) {
    setDraft(phrase.text);
    setFcScene2Text(phrase.text);
    onClose();
  }

  function deletePhrase(phrase: FcPhrase) {
    if (!window.confirm(`Delete "${phrase.text}"?`)) return;
    removeFcScene2Phrase(phrase.id);
  }

  return (
    <ModalShell
      title="Scene 2 text"
      subtitle={`Overlay shown over the person in bed (${LANGUAGE_LABELS[language]} library).`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          New phrase
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="e.g. Time to buy your own place?"
          className="w-full px-3 py-2 rounded-2xl text-[13px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
        />
        <div className="flex items-center gap-2">
          <PrimaryButton onClick={useDraft} disabled={!draft.trim()}>
            Use for this batch
          </PrimaryButton>
          <GhostButton onClick={saveDraft} disabled={!draft.trim()}>
            Save to library
          </GhostButton>
        </div>
        {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Saved phrases
        </label>
        {phrases.length === 0 ? (
          <EmptyState>No saved phrases yet for {LANGUAGE_LABELS[language]}.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {phrases.map((p) => (
              <li
                key={p.id}
                className="group flex items-start gap-2 px-3 py-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
              >
                <button
                  onClick={() => pick(p)}
                  className="flex-1 text-left text-[12px] leading-snug"
                  title="Use this phrase"
                >
                  {p.text}
                </button>
                <button
                  onClick={() => deletePhrase(p)}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition text-neutral-400 hover:text-red-500"
                  title="Delete"
                >
                  <DeleteIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}

// ── Scene 3 CTA modal ──────────────────────────────────────────────

export function Scene3CtaLibraryModal({ onClose }: { onClose: () => void }) {
  const language = useBatchStore((s) => s.language);
  const fcScene3Text = useBatchStore((s) => s.fcScene3Text);
  const fcScene3PhraseId = useBatchStore((s) => s.fcScene3PhraseId);
  const setFcScene3Text = useBatchStore((s) => s.setFcScene3Text);
  const setFcScene3PhraseId = useBatchStore((s) => s.setFcScene3PhraseId);
  const [phrases, setPhrases] = useState<FcTranslatedPhrase[]>(() => listFcScene3Phrases());
  const [draft, setDraft] = useState<string>(fcScene3Text);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFcScene3Phrases(() => setPhrases(listFcScene3Phrases())), []);

  function saveDraft() {
    const text = draft.trim();
    if (!text) {
      setError("Enter some text first.");
      return;
    }
    try {
      addFcScene3Phrase(text);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  function useDraft() {
    setFcScene3PhraseId(null);
    setFcScene3Text(draft);
    onClose();
  }

  function pick(phrase: FcTranslatedPhrase) {
    setFcScene3PhraseId(phrase.id);
    setFcScene3Text(phrase.en);
    onClose();
  }

  function deletePhrase(phrase: FcTranslatedPhrase) {
    if (!window.confirm(`Delete "${phrase.en}"?`)) return;
    if (fcScene3PhraseId === phrase.id) setFcScene3PhraseId(null);
    removeFcScene3Phrase(phrase.id);
  }

  function languageBadge(p: FcTranslatedPhrase, lang: Exclude<Language, "en">): string {
    return p[lang] ? "✓" : "—";
  }

  return (
    <ModalShell
      title="Scene 3 CTA"
      subtitle={`Author in English; we translate at render time. Active language: ${LANGUAGE_LABELS[language]}.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          New phrase (English)
        </label>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="e.g. Start by connecting with a top-tier agent at Agent Match."
          className="w-full px-3 py-2 rounded-2xl text-[13px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
        />
        <div className="flex items-center gap-2">
          <PrimaryButton onClick={useDraft} disabled={!draft.trim()}>
            Use for this batch
          </PrimaryButton>
          <GhostButton onClick={saveDraft} disabled={!draft.trim()}>
            Save to library
          </GhostButton>
        </div>
        {error && <p className="text-[11px] text-red-500 leading-snug">{error}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
          Saved CTAs
        </label>
        {phrases.length === 0 ? (
          <EmptyState>No saved CTAs yet.</EmptyState>
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
                  onClick={() => pick(p)}
                  className="flex-1 text-left flex flex-col gap-1 min-w-0"
                  title="Use this CTA"
                >
                  <span className="text-[12px] leading-snug">{p.en}</span>
                  <span className="text-[10px] text-neutral-500 tabular-nums">
                    Cached: TL {languageBadge(p, "tl")} · ES {languageBadge(p, "es")} · ZH {languageBadge(p, "zh")}
                  </span>
                </button>
                <button
                  onClick={() => deletePhrase(p)}
                  className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition text-neutral-400 hover:text-red-500"
                  title="Delete"
                >
                  <DeleteIcon />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}
