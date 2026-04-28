"use client";

import { create } from "zustand";
import type { ContentType, Language, Post } from "@/lib/types";

interface BatchState {
  language: Language;
  contentType: ContentType;
  posts: Post[];
  loading: boolean;
  error: string | null;
  usedPhotoIds: number[];

  setLanguage: (l: Language) => void;
  setContentType: (c: ContentType) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  setPosts: (p: Post[]) => void;
  updatePost: (id: string, patch: Partial<Post>) => void;
  addUsedPhotoId: (id: number) => void;
  resetUsedPhotoIds: () => void;
}

export const useBatchStore = create<BatchState>((set) => ({
  language: "en",
  contentType: "zero_down_generic",
  posts: [],
  loading: false,
  error: null,
  usedPhotoIds: [],

  setLanguage: (language) => set({ language }),
  setContentType: (contentType) => set({ contentType }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setPosts: (posts) => set({ posts }),
  updatePost: (id, patch) =>
    set((s) => ({
      posts: s.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  addUsedPhotoId: (id) => set((s) => ({ usedPhotoIds: [...s.usedPhotoIds, id] })),
  resetUsedPhotoIds: () => set({ usedPhotoIds: [] }),
}));
