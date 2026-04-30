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
  type VideoSourcePromptIndex,
} from "@/lib/types";
import { PICKED_CLIP_COUNT } from "@/lib/videoPrompts";

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
  updateImageSlot: (promptIndex: VideoSourcePromptIndex, patch: Partial<ImageSlot>) => void;
  addUsedPhotoId: (id: number) => void;
  resetUsedPhotoIds: () => void;
  selectClip: (key: string, url: string) => void;
  deselectClip: (key: string) => void;
  clearClipSelection: () => void;
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

  setFormat: (format) =>
    set((s) => ({
      format,
      // Leaving video clears any pending picks so they don't bleed into static.
      selectedClipUrls: format === "video" ? s.selectedClipUrls : [],
      selectedClipKeys: format === "video" ? s.selectedClipKeys : [],
    })),
  setLanguage: (language) => set({ language }),
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
}));
