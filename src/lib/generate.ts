"use client";

import { useBatchStore } from "@/store/batchStore";
import {
  composeGraphicDataUrl,
  composeImageDataUrl,
  fetchAndCacheAiImage,
  fetchBatchCopy,
  fetchPhotoFor,
} from "@/lib/client";
import { batchSeedPrompt, categoryFor, AI_CREDIT_LABEL, type BatchSeedIndex } from "@/lib/imagePrompts";
import { pickRandomLibraryImages } from "@/lib/imageLibrary";
import { DEFAULT_FIT_MODE, DEFAULT_FRAMING, DEFAULT_STYLE, type FontVariant } from "@/lib/types";
import { brand } from "../../brand.config";

// Per-post image-source assignment for the 10-post static batch:
//   slots 0..3  → fresh AI (family / couple / exterior / interior)
//   slots 4..7  → previously generated AI from the local image library
//                 (mirrored to R2, persistent across sessions)
//   slots 8..9  → Pexels stock photos
// If the library doesn't have enough cached images, the leftover slots
// fall through to Pexels stock as a graceful degradation.
const FRESH_AI_COUNT = 4;
const CACHED_AI_COUNT = 4;
// const STOCK_COUNT = 2;  // implicit: total - fresh - cached

// Kick off a new batch: copy from Claude (always 10 posts), then per-post
// photo + compose in parallel. AI failures on the fresh-AI slots fall back
// to Pexels. Mid-flight failures are isolated per-post and don't kill the
// batch; the caption gets an [image error: ...] tail so it's visible.
export async function generateBatch(): Promise<void> {
  const store = useBatchStore.getState();
  const { language, contentType, staticSubMode, selectedGraphicTemplate, setLoading, setError, setPosts, resetUsedPhotoIds, addUsedPhotoId } = store;

  // Graphic sub-mode is a wholly separate pipeline — no image fetching,
  // no Pexels fallback, no library pick. Just Claude copy + an SVG render
  // per post via the /api/compose-graphic route.
  if (staticSubMode === "graphic") {
    setLoading(true);
    setError(null);
    setPosts([]);
    try {
      const copy = await fetchBatchCopy(language, contentType, "graphic", selectedGraphicTemplate);
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

      // AI poster runs are slow (Nano Banana Pro is 30-60s per image) and
      // sometimes time out, so log the failures explicitly to the console
      // for debugging instead of just stuffing the message into the
      // caption where it's invisible. The toast / error state still
      // surfaces in the caption so the user sees something on the card.
      await Promise.all(
        initial.map(async (post) => {
          if (!post.graphic) return;
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
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown error");
    } finally {
      setLoading(false);
    }
    return;
  }

  setLoading(true);
  setError(null);
  setPosts([]);
  resetUsedPhotoIds();

  try {
    const copy = await fetchBatchCopy(language, contentType);

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
    }));
    setPosts(initial);

    // Pre-pick the cached library images up-front so multiple cached slots
    // don't race for the same image and accidentally collide.
    const cachedPicks = pickRandomLibraryImages(CACHED_AI_COUNT);

    const used = new Set<number>();
    await Promise.all(
      initial.map(async (post, idx) => {
        try {
          let photoUrl: string;
          let credit: { photographer: string; sourceUrl: string };

          // Slot 0..3: fresh AI generation (mirrored + cached automatically).
          if (idx < FRESH_AI_COUNT) {
            try {
              const seedIdx = idx as BatchSeedIndex;
              const prompt = batchSeedPrompt(language, contentType, seedIdx);
              const ai = await fetchAndCacheAiImage(prompt, categoryFor(seedIdx));
              photoUrl = ai.url;
              credit = { photographer: AI_CREDIT_LABEL, sourceUrl: "" };
            } catch {
              // Fresh AI failed (rate limit, safety, etc.) → Pexels fallback.
              const photo = await fetchPhotoFor(contentType, [...used]);
              used.add(photo.id);
              addUsedPhotoId(photo.id);
              photoUrl = photo.url;
              credit = { photographer: photo.photographer, sourceUrl: photo.sourceUrl };
            }
          }
          // Slot 4..7: pull from the cached library (oldest-first sampling
          // is fine; pre-shuffled in pickRandomLibraryImages).
          else if (idx < FRESH_AI_COUNT + CACHED_AI_COUNT) {
            const cachedSlot = idx - FRESH_AI_COUNT;
            const pick = cachedPicks[cachedSlot];
            if (pick) {
              photoUrl = pick.url;
              credit = { photographer: AI_CREDIT_LABEL, sourceUrl: "" };
            } else {
              // Library not yet full enough — fall through to Pexels.
              const photo = await fetchPhotoFor(contentType, [...used]);
              used.add(photo.id);
              addUsedPhotoId(photo.id);
              photoUrl = photo.url;
              credit = { photographer: photo.photographer, sourceUrl: photo.sourceUrl };
            }
          }
          // Slot 8..9: stock photos.
          else {
            const photo = await fetchPhotoFor(contentType, [...used]);
            used.add(photo.id);
            addUsedPhotoId(photo.id);
            photoUrl = photo.url;
            credit = { photographer: photo.photographer, sourceUrl: photo.sourceUrl };
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
