"use client";

// Shared cache for the user's clip library, saved sets, and image library.
// Backed by an R2-hosted manifest at /api/library — what used to live in
// localStorage now follows the password instead of the device. Reads are
// served from an in-memory cache (seeded from a localStorage mirror for
// instant first-paint), mutations are debounced + PUT to the server, and
// window-focus refetches keep cross-device edits in sync.

import type { LibraryClip } from "./clipLibrary";
import type { SavedSet } from "./savedSets";
import type { LibraryImage } from "./imageLibrary";
import type { MusicTrack } from "./musicLibrary";
import type {
  FcActor,
  FcLocation,
  FcProject,
  FcShot,
} from "./types";

const MANIFEST_VERSION = 1;
const LOCAL_MIRROR_KEY = "content-studio-library-mirror";
// Short debounce — coalesces rapid edits (typing tags, toggling
// language pills) but keeps the gap between intent and persistence
// small enough that a quick page refresh after a delete won't strand
// the change in memory.
const WRITE_DEBOUNCE_MS = 250;

// Legacy per-module localStorage keys, used only for one-time migration
// the first time we boot against an empty server manifest.
const LEGACY_KEY_CLIPS = "video-clip-library";
const LEGACY_KEY_SETS = "video-source-sets";
const LEGACY_KEY_IMAGES = "static-image-library";

export interface Manifest {
  version: number;
  clips: LibraryClip[];
  sets: SavedSet[];
  images: LibraryImage[];
  tracks: MusicTrack[];
  // Funny Commercial v2 storyboard libraries. The old per-scene
  // slices (fcScene1Images / fcScene1Videos / fcScene2Actors /
  // fcScene2Phrases / fcScene3Phrases) were removed when the flow
  // pivoted from a fixed 4-scene template to a shot-based timeline.
  // Old persisted entries silently drop in normalizeManifest.
  fcActors: FcActor[];
  fcLocations: FcLocation[];
  fcShots: FcShot[];
  fcProjects: FcProject[];
}

const EMPTY: Manifest = {
  version: MANIFEST_VERSION,
  clips: [],
  sets: [],
  images: [],
  tracks: [],
  fcActors: [],
  fcLocations: [],
  fcShots: [],
  fcProjects: [],
};

type Slice =
  | "clips"
  | "sets"
  | "images"
  | "tracks"
  | "fcActors"
  | "fcLocations"
  | "fcShots"
  | "fcProjects";

const SLICE_EVENT: Record<Slice, string> = {
  clips: "video-clip-library-changed",
  sets: "video-saved-sets-changed",
  images: "static-image-library-changed",
  tracks: "music-library-changed",
  fcActors: "fc-actors-changed",
  fcLocations: "fc-locations-changed",
  fcShots: "fc-shots-changed",
  fcProjects: "fc-projects-changed",
};

let _state: Manifest = { ...EMPTY };
let _bootstrapped = false;
let _writeTimer: ReturnType<typeof setTimeout> | null = null;

export function getSlice<K extends Slice>(slice: K): Manifest[K] {
  return _state[slice];
}

// Replace a slice, mirror to localStorage, fire that slice's change event,
// and schedule a debounced server PUT.
export function setSlice<K extends Slice>(slice: K, value: Manifest[K]): void {
  _state = { ..._state, [slice]: value };
  writeLocalMirror(_state);
  emit(slice);
  scheduleSync();
}

function emit(slice: Slice): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SLICE_EVENT[slice]));
}

function emitAll(): void {
  if (typeof window === "undefined") return;
  for (const slice of Object.keys(SLICE_EVENT) as Slice[]) emit(slice);
}

function scheduleSync(): void {
  if (typeof window === "undefined") return;
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => {
    _writeTimer = null;
    void pushManifest(_state).catch((err) => {
      console.error("[library] PUT /api/library failed", err);
    });
  }, WRITE_DEBOUNCE_MS);
}

// Fire the pending manifest write immediately, with `keepalive: true`
// so it survives page navigation. Called from the unload + visibility
// handlers so a refresh / tab-close right after a delete doesn't
// strand the change. No-op when nothing is pending.
function flushPendingWrite(): void {
  if (typeof window === "undefined") return;
  if (!_writeTimer) return;
  clearTimeout(_writeTimer);
  _writeTimer = null;
  // Snapshot the body now — _state could mutate further before the
  // browser actually transmits the request.
  const body = JSON.stringify(_state);
  try {
    void fetch("/api/library", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    });
  } catch (err) {
    console.error("[library] flushPendingWrite failed", err);
  }
}

async function fetchManifest(): Promise<Manifest | null> {
  const res = await fetch("/api/library", { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`/api/library GET ${res.status}`);
  const json = (await res.json()) as Manifest;
  return normalizeManifest(json);
}

async function pushManifest(state: Manifest): Promise<void> {
  const res = await fetch("/api/library", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`/api/library PUT ${res.status}`);
}

function normalizeManifest(input: unknown): Manifest {
  if (!input || typeof input !== "object") return { ...EMPTY };
  const obj = input as Partial<Manifest>;
  return {
    version: typeof obj.version === "number" ? obj.version : MANIFEST_VERSION,
    clips: Array.isArray(obj.clips) ? obj.clips : [],
    sets: Array.isArray(obj.sets) ? obj.sets : [],
    images: Array.isArray(obj.images) ? obj.images : [],
    tracks: Array.isArray(obj.tracks) ? obj.tracks : [],
    fcActors: Array.isArray(obj.fcActors) ? obj.fcActors : [],
    fcLocations: Array.isArray(obj.fcLocations) ? obj.fcLocations : [],
    fcShots: Array.isArray(obj.fcShots) ? obj.fcShots : [],
    fcProjects: Array.isArray(obj.fcProjects) ? obj.fcProjects : [],
  };
}

function readLocalMirror(): Manifest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Manifest>;
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeManifest(parsed);
  } catch {
    return null;
  }
}

function writeLocalMirror(state: Manifest): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_MIRROR_KEY, JSON.stringify(state));
  } catch {
    // Quota errors etc. — the mirror is best-effort.
  }
}

// One-time migration helper: read the old per-slice keys and fold them
// into a Manifest. Returns an empty manifest if nothing is found, so the
// caller can detect "had legacy data" by inspecting the slice lengths.
function readLegacyLocalStorage(): Manifest {
  const out: Manifest = { ...EMPTY };
  if (typeof window === "undefined") return out;
  // Each legacy module wrapped its array in { version, <slice> }.
  const tryParse = <T,>(key: string, sliceKey: string): T[] => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const arr = parsed?.[sliceKey];
      return Array.isArray(arr) ? (arr as T[]) : [];
    } catch {
      return [];
    }
  };
  out.clips = tryParse<LibraryClip>(LEGACY_KEY_CLIPS, "clips");
  out.sets = tryParse<SavedSet>(LEGACY_KEY_SETS, "sets");
  out.images = tryParse<LibraryImage>(LEGACY_KEY_IMAGES, "images");
  return out;
}

// Force-refetch from the server. Called on window focus + when the user
// hits the manual refresh affordance. Silent on failure — we keep showing
// whatever we already had.
export async function refreshLibrary(): Promise<void> {
  // Flush any pending mutation BEFORE fetching. Otherwise a focus
  // refetch can adopt server state that's older than the in-memory
  // state (because the debounced PUT hasn't fired yet), clobbering the
  // user's recent change. After the flush, the server reflects intent
  // and the GET round-trip is safe.
  if (_writeTimer) {
    clearTimeout(_writeTimer);
    _writeTimer = null;
    try {
      await pushManifest(_state);
    } catch (err) {
      console.error("[library] flush-before-refresh failed", err);
      // Don't return — a fresh GET is still useful even if our PUT
      // failed (network blip, etc.).
    }
  }
  try {
    const server = await fetchManifest();
    if (!server) return;
    _state = server;
    writeLocalMirror(_state);
    emitAll();
  } catch (err) {
    console.error("[library] refresh failed", err);
  }
}

// Top-level bootstrap. Idempotent — call this once on app mount.
//
//   1. Hydrate from the localStorage mirror (instant paint).
//   2. Fetch the server manifest.
//   3. If the server has nothing AND the user has legacy per-slice data
//      from the pre-shared-library era, migrate it up. Otherwise adopt
//      the server state as truth.
export async function bootstrapLibrary(): Promise<void> {
  if (_bootstrapped) return;
  _bootstrapped = true;

  const mirror = readLocalMirror();
  if (mirror) {
    _state = mirror;
    emitAll();
  }

  try {
    const server = await fetchManifest();
    if (server === null) {
      const legacy = readLegacyLocalStorage();
      const hasLegacy =
        legacy.clips.length > 0 ||
        legacy.sets.length > 0 ||
        legacy.images.length > 0;
      if (hasLegacy) {
        _state = legacy;
        writeLocalMirror(_state);
        emitAll();
        await pushManifest(_state);
      }
      // Otherwise the in-memory state stays at whatever the mirror gave
      // us (or empty), and the server stays empty until the first write.
      return;
    }
    _state = server;
    writeLocalMirror(_state);
    emitAll();
  } catch (err) {
    console.error("[library] bootstrap fetch failed", err);
  }
}

// Refresh on tab focus so picking up where you left off on another device
// doesn't require a hard reload. Cross-tab sync on the same machine flows
// through the storage event. Flush any pending write the moment the tab
// is going away (refresh, close, background) so a delete + refresh race
// doesn't strand the change in the debounce window.
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    void refreshLibrary();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== LOCAL_MIRROR_KEY) return;
    const mirror = readLocalMirror();
    if (!mirror) return;
    _state = mirror;
    emitAll();
  });
  window.addEventListener("beforeunload", flushPendingWrite);
  // visibilitychange covers iOS / Android backgrounding (where
  // beforeunload is unreliable) and the desktop tab-switch case.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingWrite();
  });
}
