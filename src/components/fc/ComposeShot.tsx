"use client";

// ComposeShot — the primary creator panel. Walks the user through a
// shot composition state machine:
//
//   idle → composing-image → image-ready → composing-animation → done
//
// Each transition has a Keep / Tweak / Discard escape hatch so the user
// can iterate without re-spending Claude/Nano/Veo calls when they
// don't have to. Animation prompts are pre-filled by Claude (Haiku)
// based on the kept image; the user can punch them up before clicking
// Animate.

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import { getFcActor } from "@/lib/funnyCommercialActors";
import {
  addFcLocation,
  listFcLocations,
  removeFcLocation,
  subscribeFcLocations,
} from "@/lib/funnyCommercialLocations";
import {
  addFcShot,
  getFcShot,
  latestAnimatedActorShot,
  subscribeFcShots,
  updateFcShot,
} from "@/lib/funnyCommercialShots";
import {
  fcAnimateShot,
  fcComposeShotImage,
  fcGenerateLocation,
  fcWriteAnimationPrompt,
} from "@/lib/funnyCommercial";
import type { FcLocation, FcShotKind } from "@/lib/types";

export function ComposeShot() {
  const fcSelectedActorId = useBatchStore((s) => s.fcSelectedActorId);
  const fcAddToTimeline = useBatchStore((s) => s.fcAddToTimeline);
  const fcContinuitySourceShotId = useBatchStore((s) => s.fcContinuitySourceShotId);
  const setFcContinuitySourceShotId = useBatchStore((s) => s.setFcContinuitySourceShotId);
  const [kind, setKind] = useState<FcShotKind>("actor");
  const [locations, setLocations] = useState<FcLocation[]>(() => listFcLocations());
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [continuity, setContinuity] = useState(true); // per plan: default ON
  const [phase, setPhase] = useState<"idle" | "image" | "ready" | "animating" | "done">("idle");
  const [shotImageUrl, setShotImageUrl] = useState<string | null>(null);
  const [animationPrompt, setAnimationPrompt] = useState("");
  const [draftShotId, setDraftShotId] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "location" | "image" | "anim-prompt" | "animate">(null);
  const [error, setError] = useState<string | null>(null);
  // Tick when fcShots changes so the continuity-source preview always
  // reflects the latest library state (e.g., a fresh animation just
  // landed a lastFrameImageUrl on a shot we want to use as seed).
  const [shotsTick, setShotsTick] = useState(0);

  useEffect(() => subscribeFcLocations(() => setLocations(listFcLocations())), []);
  useEffect(() => subscribeFcShots(() => setShotsTick((t) => t + 1)), []);

  const actor = fcSelectedActorId ? getFcActor(fcSelectedActorId) : undefined;
  // Continuity source: explicit pin if set + still has a last frame,
  // else fall back to the most recent animated actor shot for the
  // active actor. Re-evaluated on every fcShots change via shotsTick.
  void shotsTick;
  const pinnedShot = fcContinuitySourceShotId
    ? getFcShot(fcContinuitySourceShotId)
    : undefined;
  const seedShot =
    pinnedShot && pinnedShot.lastFrameImageUrl
      ? pinnedShot
      : latestAnimatedActorShot(fcSelectedActorId ?? undefined);
  const continuityAvailable = kind === "actor" && !!seedShot?.lastFrameImageUrl;
  const continuityActive = continuity && continuityAvailable;
  const isPinnedSeed = !!pinnedShot && pinnedShot.id === seedShot?.id;

  function reset() {
    setShotImageUrl(null);
    setAnimationPrompt("");
    setDraftShotId(null);
    setPhase("idle");
    setError(null);
  }

  function deleteLocation(loc: FcLocation) {
    if (!window.confirm(`Delete location "${loc.prompt}"?`)) return;
    if (selectedLocationId === loc.id) setSelectedLocationId(null);
    removeFcLocation(loc.id);
  }

  async function generateNewLocation() {
    if (busy) return;
    const trimmed = locationDraft.trim();
    if (!trimmed) {
      setError("Describe the location first.");
      return;
    }
    setError(null);
    setBusy("location");
    try {
      const { url } = await fcGenerateLocation(trimmed);
      const loc = addFcLocation({ prompt: trimmed, imageUrl: url });
      setSelectedLocationId(loc.id);
      setLocationDraft("");
      setCreatingLocation(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "location generate failed");
    } finally {
      setBusy(null);
    }
  }

  async function composeImage() {
    if (busy) return;
    if (kind === "actor" && !fcSelectedActorId) {
      setError("Pick an actor first (Actors row above).");
      return;
    }
    if (!prompt.trim()) {
      setError("Describe the shot first.");
      return;
    }
    setError(null);
    setBusy("image");
    setPhase("image");
    try {
      const location = selectedLocationId
        ? locations.find((l) => l.id === selectedLocationId)
        : undefined;
      const { url } = await fcComposeShotImage({
        prompt: prompt.trim(),
        actorReferenceUrl: kind === "actor" ? actor?.referenceImageUrl : undefined,
        locationImageUrl: location?.imageUrl,
      });
      setShotImageUrl(url);
      setPhase("ready");

      // Kick off the animation-prompt write in parallel — user gets a
      // pre-filled textarea to refine while the image renders.
      try {
        setBusy("anim-prompt");
        const { animationPrompt: ap } = await fcWriteAnimationPrompt({
          imagePrompt: prompt.trim(),
          kind,
        });
        setAnimationPrompt(ap);
      } catch (e) {
        // Fall back to a generic high-energy prompt if Haiku fails.
        console.warn("[fc] animation prompt write failed:", e);
        setAnimationPrompt(
          kind === "actor"
            ? "the actor reacts visibly — eyes widen, head turns toward the source of the sound, slight body recoil; camera holds steady"
            : "the subject moves with full kinetic energy throughout the shot, fast-paced and dynamic; camera holds steady to let the chaos play out",
        );
      } finally {
        setBusy(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "image compose failed");
      setPhase("idle");
      setBusy(null);
    }
  }

  function discardImage() {
    reset();
  }

  async function animate() {
    if (busy) return;
    if (!animationPrompt.trim()) {
      setError("Animation prompt cannot be empty.");
      return;
    }

    // Pick the source image for both Veo and the FcShot record:
    //   - continuity on  → prior shot's last frame (Nano never ran)
    //   - continuity off → the still Nano just composed
    let sourceImageUrl: string;
    if (continuityActive && seedShot?.lastFrameImageUrl) {
      sourceImageUrl = seedShot.lastFrameImageUrl;
    } else if (shotImageUrl) {
      sourceImageUrl = shotImageUrl;
    } else {
      setError("No image to animate. Generate one first or enable continuity.");
      return;
    }

    setError(null);
    setBusy("animate");
    setPhase("animating");

    // Save the shot record now (without videoUrl) so re-animate can
    // reference it. imageUrl on the record is whatever Veo will see —
    // prior last-frame for continuity, fresh Nano still otherwise.
    const newShot = addFcShot({
      kind,
      actorId: kind === "actor" ? fcSelectedActorId ?? undefined : undefined,
      locationId: selectedLocationId ?? undefined,
      imagePrompt: prompt.trim(),
      imageUrl: sourceImageUrl,
      animationPrompt: animationPrompt.trim(),
      parentShotId: continuityActive ? seedShot!.id : undefined,
    });
    setDraftShotId(newShot.id);

    try {
      const { videoUrl, lastFrameImageUrl } = await fcAnimateShot({
        imageUrl: sourceImageUrl,
        animationPrompt: animationPrompt.trim(),
      });
      const updated = updateFcShot(newShot.id, { videoUrl, lastFrameImageUrl });
      if (updated) {
        fcAddToTimeline(updated.id);
      }
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "animate failed");
      setPhase("ready");   // let them retry
    } finally {
      setBusy(null);
    }
  }

  // Continuity-on path: ask Haiku to write an animation prompt from
  // the user's shot description without ever calling Nano. Same fall-
  // back generic prompts as the continuity-off path uses internally.
  async function writeAnimationPromptOnly() {
    if (busy) return;
    if (!prompt.trim()) {
      setError("Describe the shot first.");
      return;
    }
    setError(null);
    setBusy("anim-prompt");
    try {
      const { animationPrompt: ap } = await fcWriteAnimationPrompt({
        imagePrompt: prompt.trim(),
        kind,
      });
      setAnimationPrompt(ap);
    } catch (e) {
      console.warn("[fc] animation prompt write failed:", e);
      setAnimationPrompt(
        kind === "actor"
          ? "the actor reacts visibly — eyes widen, head turns toward the source of the sound, slight body recoil; camera holds steady"
          : "the subject moves with full kinetic energy throughout the shot, fast-paced and dynamic; camera holds steady to let the chaos play out",
      );
    } finally {
      setBusy(null);
    }
  }

  function startNew() {
    reset();
    setPrompt("");
  }

  return (
    <Section title="Compose new shot">
      <div className="flex flex-col gap-3 p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950">
        {/* Kind toggle */}
        <div className="flex items-center gap-2">
          <KindPill selected={kind === "actor"} onClick={() => setKind("actor")}>
            Actor
          </KindPill>
          <KindPill selected={kind === "crazy"} onClick={() => setKind("crazy")}>
            Crazy
          </KindPill>
          {kind === "actor" && actor && (
            <span className="text-[11px] text-neutral-500 ml-2">
              using <span className="font-medium">{actor.name}</span>
            </span>
          )}
          {kind === "actor" && !actor && (
            <span className="text-[11px] text-amber-600 ml-2">
              ⚠ pick an actor in the Actors row above
            </span>
          )}
          {continuityAvailable && (
            <label className="flex items-center gap-1.5 ml-auto text-[11px] text-neutral-500 cursor-pointer">
              <input
                type="checkbox"
                checked={continuity}
                onChange={(e) => setContinuity(e.target.checked)}
                className="accent-neutral-900 dark:accent-white"
              />
              Continue from previous actor shot
            </label>
          )}
        </div>

        {/* Location picker (optional). Cards are 9:16 to match the
            shot aspect ratio so the user can actually see what each
            location looks like before picking. */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
            Location (optional reference)
          </label>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setSelectedLocationId(null)}
              className={`w-24 h-[10.66rem] rounded-2xl border-2 transition flex items-center justify-center text-[11px] ${
                selectedLocationId === null
                  ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white"
                  : "border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-neutral-900 text-neutral-500"
              }`}
              title="No location reference"
            >
              None
            </button>
            {locations.map((l) => {
              const selected = selectedLocationId === l.id;
              return (
                <div key={l.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedLocationId(l.id)}
                    className={`w-24 h-[10.66rem] rounded-2xl overflow-hidden border-2 transition relative block ${
                      selected
                        ? "border-neutral-900 dark:border-white ring-2 ring-neutral-900 dark:ring-white"
                        : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-600"
                    }`}
                    title={l.prompt}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={l.imageUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-black/65 text-white text-[10px] leading-tight line-clamp-2 text-left">
                      {l.prompt}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteLocation(l)}
                    className="absolute top-1 right-1 p-1 rounded-full bg-black/65 text-white opacity-0 group-hover:opacity-100 transition"
                    title="Delete location"
                  >
                    <DeleteIcon />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setCreatingLocation((v) => !v)}
              className="w-24 h-[10.66rem] rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:border-neutral-500 transition flex items-center justify-center text-[11px] text-center px-2 leading-tight"
            >
              {creatingLocation ? "Cancel" : "+ Generate\nlocation"}
            </button>
          </div>
          {creatingLocation && (
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                placeholder="e.g. apartment hallway at night, dim sconce lighting"
                value={locationDraft}
                onChange={(e) => setLocationDraft(e.target.value)}
                disabled={busy === "location"}
                className="flex-1 px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={generateNewLocation}
                disabled={busy === "location"}
                className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
              >
                {busy === "location" ? "…" : "Generate"}
              </button>
            </div>
          )}
        </div>

        {/* Subject prompt */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
            Shot description
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              kind === "actor"
                ? "e.g. she's sitting up in bed, eyes wide open, listening to thumping noises through the wall"
                : "e.g. a rock climber scaling the brick exterior of the apartment building at night"
            }
            disabled={!!busy && busy !== "location"}
            rows={3}
            className="w-full px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none disabled:opacity-60"
          />
        </div>

        {error && <p className="text-[11px] text-red-500">{error}</p>}

        {/* Two render paths: continuity-on skips the Nano "Generate
            image" step entirely — Veo seeds straight from the prior
            shot's last frame. Continuity-off keeps the original
            idle → image → ready → animating → done state machine. */}
        {continuityActive && seedShot?.lastFrameImageUrl ? (
          // ── Continuity-on render ──────────────────────────────────
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="sm:w-1/2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={seedShot.lastFrameImageUrl}
                alt=""
                className="w-full aspect-[9/16] object-cover rounded-xl border border-neutral-200 dark:border-neutral-800"
              />
              <p className="text-[10px] text-neutral-500 leading-snug mt-1">
                {isPinnedSeed ? (
                  <>
                    <span className="text-emerald-600 font-semibold">Pinned seed</span> · last frame from &ldquo;{seedShot.imagePrompt.slice(0, 80)}&rdquo;
                  </>
                ) : (
                  <>
                    <span className="text-neutral-400">Auto-latest</span> · last frame from &ldquo;{seedShot.imagePrompt.slice(0, 80)}&rdquo;. Pin a different shot in the library if you want to chain from elsewhere.
                  </>
                )}
              </p>
              {isPinnedSeed && (
                <button
                  type="button"
                  onClick={() => setFcContinuitySourceShotId(null)}
                  className="text-[10px] text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 underline-offset-2 hover:underline self-start mt-0.5"
                >
                  Unpin seed (fall back to latest)
                </button>
              )}
            </div>
            <div className="sm:w-1/2 flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
                Animation prompt {busy === "anim-prompt" && <span className="normal-case text-neutral-400">— Claude is writing one…</span>}
              </label>
              <textarea
                value={animationPrompt}
                onChange={(e) => setAnimationPrompt(e.target.value)}
                disabled={phase === "animating" || busy === "anim-prompt"}
                rows={5}
                placeholder="What should move in the next 5 seconds? Plain English — short is better."
                className="w-full px-3 py-2 rounded-xl text-[11px] leading-snug border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none disabled:opacity-60"
              />
              <div className="flex flex-wrap gap-2">
                {phase !== "animating" && phase !== "done" && (
                  <>
                    <button
                      type="button"
                      onClick={animate}
                      disabled={!!busy || !animationPrompt.trim()}
                      className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
                    >
                      Animate
                    </button>
                    <button
                      type="button"
                      onClick={writeAnimationPromptOnly}
                      disabled={!!busy || !prompt.trim()}
                      className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-neutral-900 disabled:opacity-60"
                      title="Use the shot description above to draft an animation prompt with Claude"
                    >
                      {animationPrompt.trim() ? "Re-write with AI" : "Write with AI"}
                    </button>
                  </>
                )}
                {phase === "animating" && (
                  <span className="text-[11px] text-neutral-500">Animating with Veo 3.1…</span>
                )}
                {phase === "done" && draftShotId && (
                  <>
                    <span className="text-[11px] text-emerald-600 font-medium">
                      ✓ Shot added to timeline
                    </span>
                    <button
                      type="button"
                      onClick={startNew}
                      className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-neutral-900"
                    >
                      Start new shot
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : (
          // ── Continuity-off render (original Nano-then-Veo path) ─
          <>
            {phase === "idle" && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={composeImage}
                  disabled={!!busy}
                  className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
                >
                  Generate image
                </button>
              </div>
            )}
            {phase === "image" && (
              <div className="text-[12px] text-neutral-500 py-6 text-center">
                Composing the still… (Nano Banana 2)
              </div>
            )}
            {(phase === "ready" || phase === "animating" || phase === "done") && shotImageUrl && (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="sm:w-1/2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shotImageUrl}
                    alt=""
                    className="w-full aspect-[9/16] object-cover rounded-xl border border-neutral-200 dark:border-neutral-800"
                  />
                </div>
                <div className="sm:w-1/2 flex flex-col gap-2">
                  <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
                    Animation prompt {busy === "anim-prompt" && <span className="normal-case text-neutral-400">— Claude is writing one…</span>}
                  </label>
                  <textarea
                    value={animationPrompt}
                    onChange={(e) => setAnimationPrompt(e.target.value)}
                    disabled={phase === "animating" || busy === "anim-prompt"}
                    rows={5}
                    className="w-full px-3 py-2 rounded-xl text-[11px] leading-snug border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-none disabled:opacity-60"
                  />
                  <div className="flex flex-wrap gap-2">
                    {phase === "ready" && (
                      <>
                        <button
                          type="button"
                          onClick={animate}
                          disabled={!!busy}
                          className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-60"
                        >
                          Animate
                        </button>
                        <button
                          type="button"
                          onClick={composeImage}
                          disabled={!!busy}
                          className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-neutral-900 disabled:opacity-60"
                        >
                          Re-roll image
                        </button>
                        <button
                          type="button"
                          onClick={discardImage}
                          disabled={!!busy}
                          className="px-3 py-1.5 rounded-full text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 disabled:opacity-60"
                        >
                          Discard
                        </button>
                      </>
                    )}
                    {phase === "animating" && (
                      <span className="text-[11px] text-neutral-500">Animating with Veo 3.1…</span>
                    )}
                    {phase === "done" && draftShotId && (
                      <>
                        <span className="text-[11px] text-emerald-600 font-medium">
                          ✓ Shot added to timeline
                        </span>
                        <button
                          type="button"
                          onClick={startNew}
                          className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-neutral-900"
                        >
                          Start new shot
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
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

function KindPill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition ${
        selected
          ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white"
          : "border-neutral-200 dark:border-neutral-800 hover:bg-white dark:hover:bg-neutral-900"
      }`}
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
