"use client";

import { useBatchStore } from "@/store/batchStore";
import {
  composeGraphicDataUrl,
  composeImageDataUrl,
  fetchAndCacheAiImage,
  fetchBatchCopy,
  fetchPhotoBlendCopy,
  fetchPhotoFor,
} from "@/lib/client";
import { batchSeedPrompt, categoryFor, AI_CREDIT_LABEL, type BatchSeedIndex } from "@/lib/imagePrompts";
import { pickRandomLibraryImages } from "@/lib/imageLibrary";
import {
  DEFAULT_FIT_MODE,
  DEFAULT_FRAMING,
  DEFAULT_STYLE,
  type ContentType,
  type FontVariant,
} from "@/lib/types";
import { brand } from "../../brand.config";

// Photo batch (single content type, legacy slot math):
//   slots 0..3  → fresh AI
//   slots 4..7  → previously generated AI from the local library
//   slots 8..9  → Pexels stock photos
// Photo blend batch (12 posts, 4 content types interleaved):
//   slots 0..3  → fresh AI for each topic's first card
//   slots 4..7  → fresh AI for each topic's second card
//   slots 8..11 → cached library / Pexels mix for each topic's third card
// The slot rules below assume the 12-post layout when isBlend is true,
// and the 10-post layout otherwise.
const FRESH_AI_COUNT_SINGLE = 4;
const CACHED_AI_COUNT_SINGLE = 4;
const FRESH_AI_COUNT_BLEND = 8;   // 2 of each of 4 topics
const CACHED_AI_COUNT_BLEND = 4;  // 1 of each of 4 topics

// Kick off a new batch. Dispatches by staticContentType:
//   "photo" → blended 12-card flow across 4 topics (per-post contentType)
//   else    → graphic flow (no photo lookup; just Claude copy + ImageResponse render)
export async function generateBatch(): Promise<void> {
  const store = useBatchStore.getState();
  const {
    language,
    staticContentType,
    setLoading,
    setError,
    setPosts,
    resetUsedPhotoIds,
    addUsedPhotoId,
  } = store;

  // Graphic templates are a wholly separate pipeline — no image
  // fetching, no Pexels fallback, no library pick. Just Claude copy +
  // an SVG/React render per post via the /api/compose-graphic route.
  if (staticContentType !== "photo") {
    setLoading(true);
    setError(null);
    setPosts([]);
    try {
      // Graphic flows still pin to a single ContentType internally;
      // the route uses staticSubMode="graphic" + graphicTemplate to
      // dispatch. ContentType is a no-op for graphic generators (each
      // template defines its own pool) but the API contract requires
      // it, so pass a sensible default.
      const copy = await fetchBatchCopy(
        language,
        "good_agents",
        "graphic",
        staticContentType,
      );
      const initial = copy.posts.map((p, i) => ({
        id: `${Date.now()}-${i}`,
        angle: p.angle,
        headline: p.headline,
        cta: p.cta,
        caption: p.caption,
        photoUrl: "",
        imageDataUrl: undefined,
        fontVariant: "sans" as FontVariant,
        framing: { ...DEFAULT_FRAMING },
        fitMode: DEFAULT_FIT_MODE,
        style: DEFAULT_STYLE,
        staticSubMode: "graphic" as const,
        graphic: p.graphic,
        language,
      }));
      setPosts(initial);

      // AI poster runs are slow (Nano Banana Pro is 30-60s per image)
      // and sometimes time out. iOS Safari only allows 6 connections
      // per host; 3 in flight at a time leaves room for the page's
      // other fetches (library sync, image preloads).
      const COMPOSE_CONCURRENCY = 3;
      const queue = initial.slice();
      const workers = Array.from({ length: COMPOSE_CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const post = queue.shift();
          if (!post || !post.graphic) continue;
          try {
            const imageDataUrl = await composeGraphicDataUrl(post.graphic);
            useBatchStore.getState().updatePost(post.id, { imageDataUrl });
          } catch (e) {
            const message = e instanceof Error ? e.message : "unknown";
            console.error(
              `[generate] graphic render failed (template=${post.graphic.template}, angle=${post.angle}):`,
              message,
            );
            useBatchStore.getState().updatePost(post.id, {
              caption:
                post.caption +
                `\n\n[graphic error — open browser console for details: ${message}]`,
            });
          }
        }
      });
      await Promise.all(workers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setLoading(false);
    }
    return;
  }

  // ── Photo (blended) flow ───────────────────────────────────────────

  setLoading(true);
  setError(null);
  setPosts([]);
  resetUsedPhotoIds();

  try {
    const copy = await fetchPhotoBlendCopy(language);

    const initial = copy.posts.map((p, i) => ({
      id: `${Date.now()}-${i}`,
      angle: p.angle,
      headline: p.headline,
      cta: p.cta,
      caption: p.caption,
      photoUrl: "",
      imageDataUrl: undefined,
      fontVariant: (Math.random() < brand.serifChance ? "serif" : "sans") as FontVariant,
      framing: { ...DEFAULT_FRAMING },
      fitMode: DEFAULT_FIT_MODE,
      style: DEFAULT_STYLE,
      language,
      // Each photo-blend post carries its own topical contentType so
      // the per-post Pexels query / AI seed pull the right stuff.
      contentType: p.contentType,
    }));
    setPosts(initial);

    // Pre-pick cached library images up-front. Use the blend cap.
    const cachedPicks = pickRandomLibraryImages(CACHED_AI_COUNT_BLEND);

    const used = new Set<number>();
    await Promise.all(
      initial.map(async (post, idx) => {
        // Per-post contentType drives Pexels query + AI prompt seed.
        // Fall back to "good_agents" if a post somehow arrived
        // untagged (shouldn't happen with the new blend wiring, but
        // defensively keeps the photo lookup working).
        const postContentType: ContentType = post.contentType ?? "good_agents";
        try {
          let photoUrl: string;
          let credit: { photographer: string; sourceUrl: string };

          // Fresh-AI slots: first 8 of the 12-post blend (2 per topic).
          if (idx < FRESH_AI_COUNT_BLEND) {
            try {
              // The seed index space (0..3) covers the four image
              // categories (family/couple/exterior/interior). For the
              // blend, alternate seeds across the 8 fresh slots so we
              // hit each category roughly twice.
              const seedIdx = (idx % 4) as BatchSeedIndex;
              const prompt = batchSeedPrompt(language, postContentType, seedIdx);
              const ai = await fetchAndCacheAiImage(prompt, categoryFor(seedIdx));
              photoUrl = ai.url;
              credit = { photographer: AI_CREDIT_LABEL, sourceUrl: "" };
            } catch {
              const photo = await fetchPhotoFor(postContentType, [...used]);
              used.add(photo.id);
              addUsedPhotoId(photo.id);
              photoUrl = photo.url;
              credit = { photographer: photo.photographer, sourceUrl: photo.sourceUrl };
            }
          }
          // Cached-library / stock slots: last 4 of the 12-post blend.
          else {
            const cachedSlot = idx - FRESH_AI_COUNT_BLEND;
            const pick = cachedPicks[cachedSlot];
            if (pick) {
              photoUrl = pick.url;
              credit = { photographer: AI_CREDIT_LABEL, sourceUrl: "" };
            } else {
              const photo = await fetchPhotoFor(postContentType, [...used]);
              used.add(photo.id);
              addUsedPhotoId(photo.id);
              photoUrl = photo.url;
              credit = { photographer: photo.photographer, sourceUrl: photo.sourceUrl };
            }
          }

          const imageDataUrl = await composeImageDataUrl({
            photoUrl,
            headline: post.headline,
            cta: post.cta,
            fontVariant: post.fontVariant,
            framing: post.framing,
            fitMode: post.fitMode,
            style: post.style,
          });
          useBatchStore.getState().updatePost(post.id, {
            photoUrl,
            photoCredit: credit,
            imageDataUrl,
          });
        } catch (e) {
          useBatchStore.getState().updatePost(post.id, {
            caption:
              post.caption + `\n\n[image error: ${e instanceof Error ? e.message : "unknown"}]`,
          });
        }
      }),
    );
  } catch (e) {
    setError(e instanceof Error ? e.message : "unknown error");
  } finally {
    setLoading(false);
  }
}

// Suppress TS unused-vars on the legacy single-content slot constants
// — kept around in case we want a "single-topic" photo path back.
void FRESH_AI_COUNT_SINGLE;
void CACHED_AI_COUNT_SINGLE;
