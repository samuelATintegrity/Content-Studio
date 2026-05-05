"use client";

// Sidebar sections for the Funny Commercial sub-mode. Each section
// shows the CURRENTLY SELECTED asset for the active batch + a button
// to open the corresponding library modal. Mirrors the Music + Saved
// Sets visual conventions.

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  listFcScene1Videos,
  listFcScene2Actors,
  listFcScene3Phrases,
  subscribeFcScene1Videos,
  subscribeFcScene2Actors,
  subscribeFcScene3Phrases,
} from "@/lib/funnyCommercialLibrary";
import {
  Scene1LibraryModal,
  Scene2ActorLibraryModal,
  Scene2PhraseLibraryModal,
  Scene3CtaLibraryModal,
} from "./FunnyCommercialModals";

export function FunnyCommercialSections() {
  return (
    <>
      <Scene1Section />
      <Scene2ActorSection />
      <Scene2TextSection />
      <Scene3CtaSection />
    </>
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
    <div className="flex flex-col gap-3">
      <h2 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
        {title}
      </h2>
      {children}
    </div>
  );
}

function PickerButton({
  open,
  onClick,
  primaryLabel,
  countLabel,
}: {
  open?: boolean;
  onClick: () => void;
  primaryLabel: string;
  countLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 rounded-2xl text-[12px] border transition flex items-center justify-between ${
        open
          ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white"
          : "bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
      }`}
    >
      <span className="font-medium truncate text-left">{primaryLabel}</span>
      <span className="text-[11px] tabular-nums opacity-75 ml-2 shrink-0">
        {countLabel}
      </span>
    </button>
  );
}

function Scene1Section() {
  const fcSelectedScene1VideoId = useBatchStore((s) => s.fcSelectedScene1VideoId);
  const [count, setCount] = useState<number>(() => listFcScene1Videos().length);
  const [open, setOpen] = useState(false);

  useEffect(
    () => subscribeFcScene1Videos(() => setCount(listFcScene1Videos().length)),
    [],
  );

  const selected = fcSelectedScene1VideoId
    ? listFcScene1Videos().find((v) => v.id === fcSelectedScene1VideoId) ?? null
    : null;

  return (
    <Section title="Scene 1 — absurd opener">
      <PickerButton
        open={open}
        onClick={() => setOpen(true)}
        primaryLabel={selected ? (selected.themeKey ?? "Selected clip") : "Pick a Scene 1 clip"}
        countLabel={`${count} ${count === 1 ? "clip" : "clips"}`}
      />
      {selected && (
        <p className="text-[10px] text-neutral-500 leading-snug truncate" title={selected.imagePrompt ?? undefined}>
          {selected.imagePrompt ?? "Scene 1 clip"}
        </p>
      )}
      {open && <Scene1LibraryModal onClose={() => setOpen(false)} />}
    </Section>
  );
}

function Scene2ActorSection() {
  const fcSelectedScene2ActorId = useBatchStore((s) => s.fcSelectedScene2ActorId);
  const [count, setCount] = useState<number>(() => listFcScene2Actors().length);
  const [open, setOpen] = useState(false);

  useEffect(
    () => subscribeFcScene2Actors(() => setCount(listFcScene2Actors().length)),
    [],
  );

  const selected = fcSelectedScene2ActorId
    ? listFcScene2Actors().find((v) => v.id === fcSelectedScene2ActorId) ?? null
    : null;

  return (
    <Section title="Scene 2 — actor in bed">
      <PickerButton
        open={open}
        onClick={() => setOpen(true)}
        primaryLabel={
          selected ? (selected.filename ?? "Selected actor") : "Pick a Scene 2 actor"
        }
        countLabel={`${count} ${count === 1 ? "clip" : "clips"}`}
      />
      {open && <Scene2ActorLibraryModal onClose={() => setOpen(false)} />}
    </Section>
  );
}

function Scene2TextSection() {
  const fcScene2Text = useBatchStore((s) => s.fcScene2Text);
  const setFcScene2Text = useBatchStore((s) => s.setFcScene2Text);
  const [open, setOpen] = useState(false);

  return (
    <Section title="Scene 2 — text overlay">
      <textarea
        value={fcScene2Text}
        onChange={(e) => setFcScene2Text(e.target.value)}
        rows={2}
        placeholder="Time to buy your own place?"
        className="w-full px-3 py-2 rounded-2xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
      />
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline-offset-2 hover:underline text-left"
      >
        Pick from saved phrases →
      </button>
      {open && <Scene2PhraseLibraryModal onClose={() => setOpen(false)} />}
    </Section>
  );
}

function Scene3CtaSection() {
  const fcScene3Text = useBatchStore((s) => s.fcScene3Text);
  const fcScene3PhraseId = useBatchStore((s) => s.fcScene3PhraseId);
  const setFcScene3Text = useBatchStore((s) => s.setFcScene3Text);
  const setFcScene3PhraseId = useBatchStore((s) => s.setFcScene3PhraseId);
  const [count, setCount] = useState<number>(() => listFcScene3Phrases().length);
  const [open, setOpen] = useState(false);

  useEffect(
    () => subscribeFcScene3Phrases(() => setCount(listFcScene3Phrases().length)),
    [],
  );

  function onTextChange(value: string) {
    setFcScene3Text(value);
    // Editing the text input drops the saved-phrase association so we
    // don't carry over a stale phraseId that no longer matches the text.
    if (fcScene3PhraseId) setFcScene3PhraseId(null);
  }

  return (
    <Section title="Scene 3 — CTA (auto-translates)">
      <textarea
        value={fcScene3Text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={3}
        placeholder="Start by connecting with a top-tier agent at Agent Match."
        className="w-full px-3 py-2 rounded-2xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none"
      />
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline-offset-2 hover:underline text-left"
      >
        Saved CTAs ({count}) →
      </button>
      {open && <Scene3CtaLibraryModal onClose={() => setOpen(false)} />}
    </Section>
  );
}
