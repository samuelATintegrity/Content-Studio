"use client";

import { create } from "zustand";
import {
  DEFAULT_FORMAT,
  type ContentType,
  type Format,
  type ImageSlot,
  type Language,
  type Post,
  type VideoPost,
} from "@/lib/types";
import { PICKED_CLIP_COUNT } from "@/lib/videoPrompts";

export type SubMode = "narration" | "influencer";

interface BatchState {
  format: Format;
  language: Language;
  contentType: ContentType;
  posts: Post[];
  videoPosts: VideoPost[];
  imageSlots: ImageSlot[];
  loading: boolean;
  error: string | null;
  usedPhotoIds: number[];

  // Library-pick selection (clip URLs in selection-order = scene-order,
  // capped at PICKED_CLIP_COUNT). Parallel keys array drives badges.
  selectedClipUrls: string[];
  selectedClipKeys: string[];

  // Influencer-mode state. subMode toggles the second pill in the sidebar
  // ("Narration · footage" vs "Influencer"); selectedAvatarName + intro/
  // outro picks are scoped to the influencer flow only.
  subMode: SubMode;
  selectedAvatarName: string | null;
  selectedIntroClipUrl: string | null;
  selectedOutroClipUrl: string | null;

  setFormat: (f: Format) => void;
  setLanguage: (l: Language) => void;
  setContentType: (c: ContentType) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setPosts: (p: Post[]) => void;
  updatePost: (id: string, patch: Partial<Post>) => void;
  setVideoPosts: (p: VideoPost[]) => void;
  updateVideoPost: (id: string, patch: Partial<VideoPost>) => void;
  setImageSlots: (slots: ImageSlot[]) => void;
  updateImageSlot: (promptIndex: number, patch: Partial<ImageSlot>) => void;
  addUsedPhotoId: (id: number) => void;
  resetUsedPhotoIds: () => void;
  selectClip: (key: string, url: string) => void;
  deselectClip: (key: string) => void;
  clearClipSelection: () => void;
  setSubMode: (m: SubMode) => void;
  setSelectedAvatarName: (name: string | null) => void;
  setSelectedIntroClipUrl: (url: string | null) => void;
  setSelectedOutroClipUrl: (url: string | null) => void;
}

export const useBatchStore = create<BatchState>((set) => ({
  format: DEFAULT_FORMAT,
  language: "en",
  contentType: "zero_down_generic",
  posts: [],
  videoPosts: [],
  imageSlots: [],
  loading: false,
  error: null,
  usedPhotoIds: [],
  selectedClipUrls: [],
  selectedClipKeys: [],
  subMode: "narration",
  selectedAvatarName: null,
  selectedIntroClipUrl: null,
  selectedOutroClipUrl: null,

  setFormat: (format) =>
    set((s) => ({
      format,
      // Leaving video clears any pending picks so they don't bleed into static.
      selectedClipUrls: format === "video" ? s.selectedClipUrls : [],
      selectedClipKeys: format === "video" ? s.selectedClipKeys : [],
    })),
  // Switching language invalidates the avatar/intro/outro picks, since
  // each avatar's intro/outro library is language-specific.
  setLanguage: (language) =>
    set({
      language,
      selectedAvatarName: null,
      selectedIntroClipUrl: null,
      selectedOutroClipUrl: null,
    }),
  setContentType: (contentType) => set({ contentType }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setPosts: (posts) => set({ posts }),
  updatePost: (id, patch) =>
    set((s) => ({
      posts: s.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  setVideoPosts: (videoPosts) => set({ videoPosts }),
  updateVideoPost: (id, patch) =>
    set((s) => ({
      videoPosts: s.videoPosts.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    })),
  setImageSlots: (imageSlots) => set({ imageSlots }),
  updateImageSlot: (promptIndex, patch) =>
    set((s) => ({
      imageSlots: s.imageSlots.map((slot) =>
        slot.promptIndex === promptIndex ? { ...slot, ...patch } : slot,
      ),
    })),
  addUsedPhotoId: (id) => set((s) => ({ usedPhotoIds: [...s.usedPhotoIds, id] })),
  resetUsedPhotoIds: () => set({ usedPhotoIds: [] }),
  selectClip: (key, url) =>
    set((s) => {
      const existingIdx = s.selectedClipKeys.indexOf(key);
      if (existingIdx >= 0) {
        // Toggle off; later picks renumber by virtue of array index.
        return {
          selectedClipKeys: s.selectedClipKeys.filter((_, i) => i !== existingIdx),
          selectedClipUrls: s.selectedClipUrls.filter((_, i) => i !== existingIdx),
        };
      }
      if (s.selectedClipKeys.length >= PICKED_CLIP_COUNT) return {};
      return {
        selectedClipKeys: [...s.selectedClipKeys, key],
        selectedClipUrls: [...s.selectedClipUrls, url],
      };
    }),
  deselectClip: (key) =>
    set((s) => {
      const idx = s.selectedClipKeys.indexOf(key);
      if (idx < 0) return {};
      return {
        selectedClipKeys: s.selectedClipKeys.filter((_, i) => i !== idx),
        selectedClipUrls: s.selectedClipUrls.filter((_, i) => i !== idx),
      };
    }),
  clearClipSelection: () => set({ selectedClipKeys: [], selectedClipUrls: [] }),
  // Switching sub-mode resets the picked clips and avatar/intro/outro
  // selections, since the two flows pick into the same selection slice but
  // have different shape requirements.
  setSubMode: (subMode) =>
    set({
      subMode,
      selectedClipKeys: [],
      selectedClipUrls: [],
      selectedAvatarName: null,
      selectedIntroClipUrl: null,
      selectedOutroClipUrl: null,
    }),
  // Switching the avatar invalidates the intro/outro picks, since both are
  // filtered by avatar.
  setSelectedAvatarName: (name) =>
    set({
      selectedAvatarName: name,
      selectedIntroClipUrl: null,
      selectedOutroClipUrl: null,
    }),
  setSelectedIntroClipUrl: (url) => set({ selectedIntroClipUrl: url }),
  setSelectedOutroClipUrl: (url) => set({ selectedOutroClipUrl: url }),
}));
