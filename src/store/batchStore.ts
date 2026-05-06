"use client";

import { create } from "zustand";
import {
  DEFAULT_FORMAT,
  DEFAULT_MESSAGE_THEME,
  DEFAULT_STATIC_CONTENT_TYPE,
  type ContentType,
  type FcRenderTarget,
  type FcTimelineItem,
  type FcTimelineOverlay,
  type Format,
  type ImageSlot,
  type Language,
  type MessageTheme,
  type Post,
  type StaticContentType,
  type VideoPost,
} from "@/lib/types";
import { PICKED_CLIP_COUNT } from "@/lib/videoPrompts";

export type SubMode = "narration" | "influencer" | "funny_commercial";

interface BatchState {
  format: Format;
  language: Language;
  contentType: ContentType;
  // Single picker for static-format content. "photo" runs the
  // blended 12-card flow across all four topical content types;
  // each other value dispatches to its corresponding graphic
  // template. Replaces the older staticSubMode + selectedGraphicTemplate
  // pair (those still ship in types.ts as deprecated for back-compat).
  staticContentType: StaticContentType;
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
  // outro picks are scoped to the influencer flow only. selectedMessageTheme
  // chooses which scripted topic the influencer is delivering — each theme
  // has its own pre-recorded intro/outro library.
  subMode: SubMode;
  selectedAvatarName: string | null;
  selectedIntroClipUrl: string | null;
  selectedOutroClipUrl: string | null;
  selectedMessageTheme: MessageTheme;

  // Funny Commercial v2 per-batch state. The user picks one actor
  // (whose face is locked across every shot they appear in), composes
  // shots into the shared `fcShots` library, then orders shot
  // references on a timeline before rendering. Cleared on sub-mode
  // swap.
  fcSelectedActorId: string | null;
  fcTimelineItems: FcTimelineItem[];
  fcRenderTarget: FcRenderTarget;

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
  setStaticContentType: (t: StaticContentType) => void;
  setSelectedAvatarName: (name: string | null) => void;
  setSelectedIntroClipUrl: (url: string | null) => void;
  setSelectedOutroClipUrl: (url: string | null) => void;
  setSelectedMessageTheme: (t: MessageTheme) => void;
  setFcSelectedActorId: (id: string | null) => void;
  setFcTimelineItems: (items: FcTimelineItem[]) => void;
  fcAddToTimeline: (shotId: string) => void;
  fcRemoveFromTimeline: (slotId: string) => void;
  fcReorderTimeline: (slotId: string, toIndex: number) => void;
  fcSetTimelineOverlay: (slotId: string, overlay: FcTimelineOverlay | null) => void;
  setFcRenderTarget: (target: FcRenderTarget) => void;
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
  staticContentType: DEFAULT_STATIC_CONTENT_TYPE,
  selectedAvatarName: null,
  selectedIntroClipUrl: null,
  selectedOutroClipUrl: null,
  selectedMessageTheme: DEFAULT_MESSAGE_THEME,
  fcSelectedActorId: null,
  fcTimelineItems: [],
  fcRenderTarget: "mp4",

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
  // selections, since the three flows pick into overlapping store
  // slots with different shape requirements. Funny-commercial picks
  // are also cleared so a stale actor / timeline doesn't carry over.
  setSubMode: (subMode) =>
    set({
      subMode,
      selectedClipKeys: [],
      selectedClipUrls: [],
      selectedAvatarName: null,
      selectedIntroClipUrl: null,
      selectedOutroClipUrl: null,
      fcSelectedActorId: null,
      fcTimelineItems: [],
    }),
  // Switching static content type clears any in-progress batch.
  // Photo posts and the four graphic templates all have very
  // different shapes; leaving stale state across the swap shows
  // posts that don't match the new picker selection.
  setStaticContentType: (staticContentType) =>
    set({ staticContentType, posts: [] }),
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
  // Switching message theme invalidates the intro/outro picks — each theme
  // has its own bookend library, so the previously-selected clips would be
  // wrong for the new topic.
  setSelectedMessageTheme: (selectedMessageTheme) =>
    set({
      selectedMessageTheme,
      selectedIntroClipUrl: null,
      selectedOutroClipUrl: null,
    }),
  setFcSelectedActorId: (fcSelectedActorId) => set({ fcSelectedActorId }),
  setFcTimelineItems: (fcTimelineItems) => set({ fcTimelineItems }),
  // Append a fresh slot to the timeline pointing at the given shot.
  // Slot id is generated locally so the React keys stay stable across
  // re-renders. Multiple slots can reference the same shot — useful
  // when a single shot bookends an ad.
  fcAddToTimeline: (shotId) =>
    set((s) => ({
      fcTimelineItems: [
        ...s.fcTimelineItems,
        {
          id: `fc-slot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          shotId,
        },
      ],
    })),
  fcRemoveFromTimeline: (slotId) =>
    set((s) => ({
      fcTimelineItems: s.fcTimelineItems.filter((i) => i.id !== slotId),
    })),
  // Reorder a single slot to a new index. Indices are clamped to the
  // current timeline length; out-of-range moves are no-ops.
  fcReorderTimeline: (slotId, toIndex) =>
    set((s) => {
      const fromIndex = s.fcTimelineItems.findIndex((i) => i.id === slotId);
      if (fromIndex < 0) return {};
      const target = Math.max(0, Math.min(toIndex, s.fcTimelineItems.length - 1));
      if (fromIndex === target) return {};
      const next = s.fcTimelineItems.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(target, 0, moved);
      return { fcTimelineItems: next };
    }),
  // Set or clear the overlay on a slot.
  fcSetTimelineOverlay: (slotId, overlay) =>
    set((s) => ({
      fcTimelineItems: s.fcTimelineItems.map((i) =>
        i.id === slotId
          ? { ...i, overlay: overlay ?? undefined }
          : i,
      ),
    })),
  setFcRenderTarget: (fcRenderTarget) => set({ fcRenderTarget }),
}));
