"use client";

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  addFcActor,
  listFcActors,
  removeFcActor,
  subscribeFcActors,
} from "@/lib/funnyCommercialActors";
import { fcGenerateActor } from "@/lib/funnyCommercial";
import type { FcActor } from "@/lib/types";

// Actors row: horizontal scrollable list of saved actor portraits +
// an inline "Generate actor" form. Clicking an actor selects them as
// the active face for newly-composed shots. Selection is sticky across
// shots (you can compose multiple shots in a row without re-picking).

export function ActorsSection() {
  const fcSelectedActorId = useBatchStore((s) => s.fcSelectedActorId);
  const setFcSelectedActorId = useBatchStore((s) => s.setFcSelectedActorId);
  const [actors, setActors] = useState<FcActor[]>(() => listFcActors());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeFcActors(() => setActors(listFcActors())), []);

  async function generate() {
    if (busy) return;
    const trimmedName = name.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedName || !trimmedPrompt) {
      setError("Both name and a description are required.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { url } = await fcGenerateActor(trimmedPrompt);
      const actor = addFcActor({
        name: trimmedName,
        referenceImageUrl: url,
        prompt: trimmedPrompt,
      });
      setFcSelectedActorId(actor.id);
      setName("");
      setPrompt("");
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "generate failed");
    } finally {
      setBusy(false);
    }
  }

  function deleteActor(actor: FcActor) {
    if (!window.confirm(`Delete actor "${actor.name}"?`)) return;
    if (fcSelectedActorId === actor.id) setFcSelectedActorId(null);
    removeFcActor(actor.id);
  }

  return (
    <Section title="Actors">
      <div className="flex gap-3 flex-wrap">
        {actors.map((a) => {
          const selected = fcSelectedActorId === a.id;
          return (
            <div key={a.id} className="group relative">
              <button
                type="button"
                onClick={() => setFcSelectedActorId(selected ? null : a.id)}
                className={`flex flex-col items-center gap-1.5 ${
                  selected ? "ring-2 ring-neutral-900 dark:ring-white rounded-2xl" : ""
                }`}
                title={selected ? "Click to deselect" : "Use this actor"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.referenceImageUrl}
                  alt={a.name}
                  className="w-20 h-28 object-cover rounded-2xl border border-neutral-200 dark:border-neutral-800"
                />
                <span className="text-[11px] font-medium truncate max-w-[80px]">
                  {a.name}
                </span>
              </button>
              <button
                onClick={() => deleteActor(a)}
                className="absolute top-1 right-1 p-1 rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 transition"
                title="Delete actor"
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="w-20 h-28 rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 hover:border-neutral-500 transition flex flex-col items-center justify-center text-[11px] text-neutral-500 gap-1"
          >
            <PlusIcon />
            New
          </button>
        )}
      </div>
      {creating && (
        <div className="flex flex-col gap-2 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Name (e.g. Maria)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              className="flex-1 px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
              className="text-[11px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Cancel
            </button>
          </div>
          <textarea
            placeholder="Describe the actor — age, look, vibe (e.g. 'a woman in her early 30s, casual sleepwear, kind eyes, light brown hair')"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
            rows={3}
            className="w-full px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none disabled:opacity-60"
          />
          {error && <p className="text-[11px] text-red-500">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
            >
              {busy ? "Generating…" : "Generate actor"}
            </button>
          </div>
        </div>
      )}
    </Section>
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
    <section className="flex flex-col gap-3">
      <h2 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PlusIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
