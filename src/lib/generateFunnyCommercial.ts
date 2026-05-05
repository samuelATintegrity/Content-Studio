"use client";

// Funny Commercial — batch orchestration.
//
// Validates the user's per-batch selections, resolves the Scene 3 CTA
// to the active language (auto-translating + caching when needed), and
// dispatches a single render job to the worker. The result is a
// VideoPost with mode === "funny_commercial" so the existing
// VideoCard + polling machinery picks it up unchanged.

import { useBatchStore } from "@/store/batchStore";
import {
  listFcScene1Videos,
  listFcScene2Actors,
  listFcScene3Phrases,
  setFcScene3Translation,
} from "@/lib/funnyCommercialLibrary";
import { fcTranslate } from "@/lib/funnyCommercial";
import { startFunnyCommercialRender } from "@/lib/videoClient";
import type { Language, VideoPost } from "@/lib/types";

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// Resolve a Scene 3 phrase to text in the active language. If the user
// typed free-text (no phraseId), translate live. If they picked a
// saved phrase, use the cached translation when present, otherwise
// translate and cache it back into the library so subsequent renders
// in the same language are free + reviewable.
async function resolveScene3Text(args: {
  language: Language;
  phraseId: string | null;
  freeText: string;
}): Promise<string> {
  const { language, phraseId, freeText } = args;
  if (language === "en") {
    if (phraseId) {
      const phrase = listFcScene3Phrases().find((p) => p.id === phraseId);
      if (phrase) return phrase.en;
    }
    return freeText.trim();
  }
  // Non-English target.
  if (phraseId) {
    const phrase = listFcScene3Phrases().find((p) => p.id === phraseId);
    if (!phrase) {
      // Phrase was deleted between selection and render; fall back to free text.
      if (!freeText.trim()) throw new Error("Scene 3 text is empty");
      return await fcTranslate(freeText, language);
    }
    const cached = phrase[language];
    if (typeof cached === "string" && cached.length > 0) return cached;
    const translated = await fcTranslate(phrase.en, language);
    setFcScene3Translation(phrase.id, language, translated);
    return translated;
  }
  if (!freeText.trim()) throw new Error("Scene 3 text is empty");
  return await fcTranslate(freeText, language);
}

export async function generateFunnyCommercialBatch(): Promise<void> {
  const state = useBatchStore.getState();
  const {
    language,
    fcSelectedScene1VideoId,
    fcSelectedScene2ActorId,
    fcScene2Text,
    fcScene3PhraseId,
    fcScene3Text,
    setLoading,
    setError,
    setVideoPosts,
    updateVideoPost,
  } = state;

  // ── Validation ────────────────────────────────────────────────────
  if (!fcSelectedScene1VideoId) {
    setError("Pick a Scene 1 video first.");
    return;
  }
  if (!fcSelectedScene2ActorId) {
    setError("Pick a Scene 2 actor video first.");
    return;
  }
  if (!fcScene2Text.trim()) {
    setError("Scene 2 text overlay is empty.");
    return;
  }
  if (!fcScene3Text.trim() && !fcScene3PhraseId) {
    setError("Scene 3 CTA is empty.");
    return;
  }
  const scene1 = listFcScene1Videos().find((v) => v.id === fcSelectedScene1VideoId);
  if (!scene1) {
    setError("Selected Scene 1 video is no longer in the library.");
    return;
  }
  const scene2 = listFcScene2Actors().find((v) => v.id === fcSelectedScene2ActorId);
  if (!scene2) {
    setError("Selected Scene 2 actor is no longer in the library.");
    return;
  }

  setError(null);
  setLoading(true);

  // Single-card batch — funny_commercial produces one ad per click.
  // VideoPost shape mirrors the narration / influencer flow so the
  // existing VideoCard + polling code work without changes.
  const id = newId("fc");
  const initial: VideoPost = {
    id,
    angle: "funny_commercial",
    script: "",
    caption: "",
    jobId: null,
    state: "queued",
    progress: 0.05,
    mode: "narration", // legacy union — see note below
    language,
  };
  setVideoPosts([initial]);

  try {
    // Resolve Scene 3 text (translate + cache if needed).
    const scene3Text = await resolveScene3Text({
      language,
      phraseId: fcScene3PhraseId,
      freeText: fcScene3Text,
    });

    // Dispatch the render job.
    const { jobId } = await startFunnyCommercialRender({
      language,
      scene1VideoUrl: scene1.url,
      scene2VideoUrl: scene2.url,
      scene2Text: fcScene2Text.trim(),
      scene3Text,
    });
    updateVideoPost(id, { jobId, state: "queued", progress: 0.1 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Funny Commercial render failed";
    setError(msg);
    updateVideoPost(id, { state: "failed", error: msg });
  } finally {
    setLoading(false);
  }
}
