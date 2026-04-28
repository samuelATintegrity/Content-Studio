"use client";

import { useBatchStore } from "@/store/batchStore";
import {
  composeImageDataUrl,
  fetchAiImage,
  fetchBatchCopy,
  fetchPhotoFor,
} from "@/lib/client";
import { batchSeedPrompt, AI_CREDIT_LABEL } from "@/lib/imagePrompts";
import { DEFAULT_FIT_MODE, DEFAULT_FRAMING, DEFAULT_STYLE, type FontVariant } from "@/lib/types";
import { brand } from "../../brand.config";

// Kick off a new batch: copy from Claude, then per-post photo + compose in
// parallel. First two posts get AI images (family + couple, or two agents for
// good_agents content) with an ethnicity hint based on language; the rest pull
// from Pexels. AI failures fall back silently to Pexels.
export async function generateBatch(): Promise<void> {
  const store = useBatchStore.getState();
  const { language, contentType, setLoading, setError, setPosts, resetUsedPhotoIds, addUsedPhotoId } = store;

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
    }));
    setPosts(initial);

    const used = new Set<number>();
    await Promise.all(
      initial.map(async (post, idx) => {
        try {
          let photoUrl: string;
          let credit: { photographer: string; sourceUrl: string };

          const useAi = idx < 2;
          let aiSucceeded = false;

          if (useAi) {
            try {
              const prompt = batchSeedPrompt(language, contentType, idx as 0 | 1);
              const ai = await fetchAiImage(prompt);
              photoUrl = ai.url;
              credit = { photographer: AI_CREDIT_LABEL, sourceUrl: "" };
              aiSucceeded = true;
            } catch {
              // fall through to Pexels
            }
          }

          if (!aiSucceeded) {
            const photo = await fetchPhotoFor(contentType, [...used]);
            used.add(photo.id);
            addUsedPhotoId(photo.id);
            photoUrl = photo.url;
            credit = { photographer: photo.photographer, sourceUrl: photo.sourceUrl };
          }

          const imageDataUrl = await composeImageDataUrl({
            photoUrl: photoUrl!,
            headline: post.headline,
            cta: post.cta,
            fontVariant: post.fontVariant,
            framing: post.framing,
            fitMode: post.fitMode,
            style: post.style,
          });
          useBatchStore.getState().updatePost(post.id, {
            photoUrl: photoUrl!,
            photoCredit: credit!,
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
