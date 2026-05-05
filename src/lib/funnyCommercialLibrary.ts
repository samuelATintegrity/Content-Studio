"use client";

// Funny Commercial — per-scene library helpers.
//
// Five separate libraries, all backed by the unified libraryStore manifest:
//   - fcScene1Images    — Nano-generated source images for the absurd Scene 1
//   - fcScene1Videos    — Seedance-animated final Scene 1 clips
//   - fcScene2Actors    — "person lying in bed" clips (uploaded OR AI-gen)
//   - fcScene2Phrases   — saved Scene 2 text overlays, language-tagged
//   - fcScene3Phrases   — saved Scene 3 CTAs, en source + cached translations
//
// Each library exposes the same shape: list + add + remove + subscribe.
// Mirrors src/lib/musicLibrary.ts which is the gold-standard pattern.

import { getSlice, setSlice } from "./libraryStore";
import type {
  FcSceneImage,
  FcSceneVideo,
  FcPhrase,
  FcTranslatedPhrase,
  Language,
} from "./types";

// ── Scene 1 images ──────────────────────────────────────────────────

export function listFcScene1Images(): FcSceneImage[] {
  return getSlice("fcScene1Images").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addFcScene1Image(input: Omit<FcSceneImage, "id" | "savedAt">): FcSceneImage {
  const all = getSlice("fcScene1Images");
  const existing = all.find((i) => i.url === input.url);
  if (existing) return existing;
  const entry: FcSceneImage = {
    ...input,
    id: `fc-img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  setSlice("fcScene1Images", [...all, entry]);
  return entry;
}

export function removeFcScene1Image(id: string): FcSceneImage | undefined {
  const all = getSlice("fcScene1Images");
  const found = all.find((i) => i.id === id);
  if (!found) return undefined;
  setSlice("fcScene1Images", all.filter((i) => i.id !== id));
  return found;
}

export function subscribeFcScene1Images(cb: () => void): () => void {
  return subscribeEvent("fc-scene1-images-changed", cb);
}

// ── Scene 1 videos ──────────────────────────────────────────────────

export function listFcScene1Videos(): FcSceneVideo[] {
  return getSlice("fcScene1Videos").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addFcScene1Video(input: Omit<FcSceneVideo, "id" | "savedAt">): FcSceneVideo {
  const all = getSlice("fcScene1Videos");
  const existing = all.find((v) => v.url === input.url);
  if (existing) return existing;
  const entry: FcSceneVideo = {
    ...input,
    id: `fc-vid-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  setSlice("fcScene1Videos", [...all, entry]);
  return entry;
}

export function removeFcScene1Video(id: string): FcSceneVideo | undefined {
  const all = getSlice("fcScene1Videos");
  const found = all.find((v) => v.id === id);
  if (!found) return undefined;
  setSlice("fcScene1Videos", all.filter((v) => v.id !== id));
  return found;
}

export function subscribeFcScene1Videos(cb: () => void): () => void {
  return subscribeEvent("fc-scene1-videos-changed", cb);
}

// ── Scene 2 actor clips ─────────────────────────────────────────────

export function listFcScene2Actors(): FcSceneVideo[] {
  return getSlice("fcScene2Actors").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addFcScene2Actor(input: Omit<FcSceneVideo, "id" | "savedAt">): FcSceneVideo {
  const all = getSlice("fcScene2Actors");
  const existing = all.find((v) => v.url === input.url);
  if (existing) return existing;
  const entry: FcSceneVideo = {
    ...input,
    id: `fc-act-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  setSlice("fcScene2Actors", [...all, entry]);
  return entry;
}

export function removeFcScene2Actor(id: string): FcSceneVideo | undefined {
  const all = getSlice("fcScene2Actors");
  const found = all.find((v) => v.id === id);
  if (!found) return undefined;
  setSlice("fcScene2Actors", all.filter((v) => v.id !== id));
  return found;
}

export function subscribeFcScene2Actors(cb: () => void): () => void {
  return subscribeEvent("fc-scene2-actors-changed", cb);
}

// ── Scene 2 text overlay phrases ────────────────────────────────────

export function listFcScene2Phrases(language?: Language): FcPhrase[] {
  const all = getSlice("fcScene2Phrases").slice().sort((a, b) => b.savedAt - a.savedAt);
  return language ? all.filter((p) => p.language === language) : all;
}

export function addFcScene2Phrase(input: Omit<FcPhrase, "id" | "savedAt">): FcPhrase {
  const all = getSlice("fcScene2Phrases");
  // Dedupe by exact (text, language) match.
  const trimmed = input.text.trim();
  if (!trimmed) throw new Error("Scene 2 phrase cannot be empty");
  const existing = all.find(
    (p) => p.text === trimmed && p.language === input.language,
  );
  if (existing) return existing;
  const entry: FcPhrase = {
    ...input,
    text: trimmed,
    id: `fc-p2-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    savedAt: Date.now(),
  };
  setSlice("fcScene2Phrases", [...all, entry]);
  return entry;
}

export function removeFcScene2Phrase(id: string): FcPhrase | undefined {
  const all = getSlice("fcScene2Phrases");
  const found = all.find((p) => p.id === id);
  if (!found) return undefined;
  setSlice("fcScene2Phrases", all.filter((p) => p.id !== id));
  return found;
}

export function subscribeFcScene2Phrases(cb: () => void): () => void {
  return subscribeEvent("fc-scene2-phrases-changed", cb);
}

// ── Scene 3 CTA phrases (with cached translations) ──────────────────

export function listFcScene3Phrases(): FcTranslatedPhrase[] {
  return getSlice("fcScene3Phrases").slice().sort((a, b) => b.savedAt - a.savedAt);
}

export function addFcScene3Phrase(en: string): FcTranslatedPhrase {
  const trimmed = en.trim();
  if (!trimmed) throw new Error("Scene 3 phrase cannot be empty");
  const all = getSlice("fcScene3Phrases");
  const existing = all.find((p) => p.en === trimmed);
  if (existing) return existing;
  const entry: FcTranslatedPhrase = {
    id: `fc-p3-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    en: trimmed,
    savedAt: Date.now(),
  };
  setSlice("fcScene3Phrases", [...all, entry]);
  return entry;
}

// Update a Scene 3 phrase's cached translation for one language. No-op
// when no entry has that id.
export function setFcScene3Translation(
  id: string,
  language: Exclude<Language, "en">,
  translated: string,
): void {
  const all = getSlice("fcScene3Phrases");
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return;
  const next = [...all];
  next[idx] = { ...next[idx], [language]: translated.trim() };
  setSlice("fcScene3Phrases", next);
}

export function removeFcScene3Phrase(id: string): FcTranslatedPhrase | undefined {
  const all = getSlice("fcScene3Phrases");
  const found = all.find((p) => p.id === id);
  if (!found) return undefined;
  setSlice("fcScene3Phrases", all.filter((p) => p.id !== id));
  return found;
}

// Read the active-language text for a Scene 3 phrase. Returns the cached
// translation when present, or undefined when the language hasn't been
// resolved yet (caller should kick off a translation).
export function fcScene3TextFor(
  phrase: FcTranslatedPhrase,
  language: Language,
): string | undefined {
  if (language === "en") return phrase.en;
  const cached = phrase[language];
  return typeof cached === "string" && cached.length > 0 ? cached : undefined;
}

export function subscribeFcScene3Phrases(cb: () => void): () => void {
  return subscribeEvent("fc-scene3-phrases-changed", cb);
}

// ── Shared subscribe helper ─────────────────────────────────────────

function subscribeEvent(eventName: string, cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener(eventName, handler);
  return () => {
    window.removeEventListener(eventName, handler);
  };
}
