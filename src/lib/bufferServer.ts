// Server-side helpers for the Buffer relay. Reads the access token + a
// language-keyed profile map from env vars so the user only has to set
// it up once per deploy. Per-language map shape:
//
//   { "en": { "facebook": "...", "instagram": "...", "tiktok": "..." },
//     "tl": {...}, "es": {...}, "zh": {...} }
//
// Missing platforms inside a language entry are silently skipped at queue
// time so the user can roll out language-by-language without errors.

import type { Language } from "./types";

export type SocialPlatform = "facebook" | "instagram" | "tiktok";

export interface BufferProfileMap {
  [language: string]: Partial<Record<SocialPlatform, string>>;
}

const BUFFER_API_BASE = "https://api.bufferapp.com/1";

export interface BufferProfile {
  id: string;
  service: string;          // "facebook" | "instagram" | "tiktok" | other
  service_username?: string;
  formatted_username?: string;
  // Facebook returns a "type" of "page" / "profile". Pages are what we want.
  service_type?: string;
}

export function getBufferAccessToken(): string {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error("BUFFER_ACCESS_TOKEN env var is not set");
  return token;
}

// Parses BUFFER_PROFILE_MAP_JSON. Returns an empty map (and no throw) when
// unset so the diagnostic /profiles route still works for first-time
// setup before the user has filled in the mapping.
export function getBufferProfileMap(): BufferProfileMap {
  const raw = process.env.BUFFER_PROFILE_MAP_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as BufferProfileMap;
  } catch {
    return {};
  }
}

export function profileIdsForLanguage(
  map: BufferProfileMap,
  language: Language,
): Array<{ platform: SocialPlatform; profileId: string }> {
  const entry = map[language];
  if (!entry) return [];
  const out: Array<{ platform: SocialPlatform; profileId: string }> = [];
  for (const platform of ["facebook", "instagram", "tiktok"] as SocialPlatform[]) {
    const profileId = entry[platform];
    if (profileId) out.push({ platform, profileId });
  }
  return out;
}

export async function listBufferProfiles(): Promise<BufferProfile[]> {
  const token = getBufferAccessToken();
  const res = await fetch(`${BUFFER_API_BASE}/profiles.json?access_token=${encodeURIComponent(token)}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Buffer /profiles.json failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as BufferProfile[];
}

// Schedule mode for Buffer updates:
//   "now"       → post immediately
//   "queue"     → add to the top of each profile's auto-queue (next slot)
//   "scheduled" → custom timestamp (scheduledAt, unix seconds)
//   "draft"     → land in the user's drafts (default; user schedules later)
export type BufferScheduleMode = "now" | "queue" | "scheduled" | "draft";

// Create a Buffer "update" (queued post) on one or more profiles. Video
// URL must be publicly accessible (R2 URLs work). Throws on Buffer-side
// error. Schedule semantics handled via Buffer's `now` / `top` /
// `scheduled_at` form fields per the API spec.
export async function createBufferUpdate(args: {
  profileIds: string[];
  text: string;
  videoUrl: string;
  thumbnailUrl?: string;
  scheduleMode?: BufferScheduleMode;
  // Required when scheduleMode === "scheduled". Unix seconds (UTC).
  scheduledAtSec?: number;
}): Promise<{ updateIds: string[] }> {
  if (args.profileIds.length === 0) {
    throw new Error("createBufferUpdate: at least one profileId required");
  }

  const token = getBufferAccessToken();
  const form = new URLSearchParams();
  form.append("text", args.text);
  for (const id of args.profileIds) form.append("profile_ids[]", id);
  form.append("media[video]", args.videoUrl);
  if (args.thumbnailUrl) form.append("media[thumbnail]", args.thumbnailUrl);
  form.append("media[link]", args.videoUrl);

  const mode = args.scheduleMode ?? "draft";
  if (mode === "now") {
    form.append("now", "true");
  } else if (mode === "queue") {
    form.append("top", "true");
  } else if (mode === "scheduled") {
    if (!args.scheduledAtSec || !Number.isFinite(args.scheduledAtSec)) {
      throw new Error("scheduledAtSec required when scheduleMode === 'scheduled'");
    }
    form.append("scheduled_at", String(Math.floor(args.scheduledAtSec)));
  }
  // mode === "draft": no extra fields → Buffer stages it in drafts.

  const res = await fetch(
    `${BUFFER_API_BASE}/updates/create.json?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Buffer /updates/create.json failed (${res.status}): ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    success?: boolean;
    updates?: Array<{ id: string }>;
    message?: string;
  };
  if (!json.success || !Array.isArray(json.updates)) {
    throw new Error(json.message ?? "Buffer returned an unsuccessful response");
  }
  return { updateIds: json.updates.map((u) => u.id) };
}

// A pending (scheduled or queued) Buffer update enriched with the
// profile's display info so the UI can render "X · facebook · @page-name"
// without a second round-trip.
export interface PendingBufferUpdate {
  id: string;
  text: string;
  scheduledAtSec: number | null;
  status: string;
  service: string;            // facebook | instagram | tiktok
  profileId: string;
  profileUsername?: string;
  videoThumbnailUrl?: string;
}

// List every pending update across the configured profile IDs. Buffer's
// /profiles/:id/updates/pending.json is per-profile, so we fan out and
// merge. Empty profileIds returns an empty list (callers should pass the
// flattened map).
export async function listPendingUpdates(profileIds: string[]): Promise<PendingBufferUpdate[]> {
  if (profileIds.length === 0) return [];
  const token = getBufferAccessToken();
  const profiles = await listBufferProfiles().catch(() => [] as BufferProfile[]);
  const usernameById = new Map(profiles.map((p) => [p.id, p.formatted_username ?? p.service_username] as const));
  const serviceById = new Map(profiles.map((p) => [p.id, p.service] as const));

  const tasks = profileIds.map(async (pid) => {
    const url = `${BUFFER_API_BASE}/profiles/${encodeURIComponent(pid)}/updates/pending.json?access_token=${encodeURIComponent(token)}&count=50`;
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return [] as PendingBufferUpdate[];
    const json = (await res.json()) as {
      updates?: Array<{
        id: string;
        text?: string;
        scheduled_at?: number | null;
        status?: string;
        media?: { thumbnail?: string };
      }>;
    };
    const updates = Array.isArray(json.updates) ? json.updates : [];
    return updates.map<PendingBufferUpdate>((u) => ({
      id: u.id,
      text: u.text ?? "",
      scheduledAtSec: typeof u.scheduled_at === "number" ? u.scheduled_at : null,
      status: u.status ?? "buffer",
      service: serviceById.get(pid) ?? "",
      profileId: pid,
      profileUsername: usernameById.get(pid),
      videoThumbnailUrl: u.media?.thumbnail,
    }));
  });

  const results = await Promise.all(tasks);
  const flat = results.flat();
  // Surface earliest-scheduled first; queued (no scheduled_at) drops to end.
  flat.sort((a, b) => {
    const aT = a.scheduledAtSec ?? Number.POSITIVE_INFINITY;
    const bT = b.scheduledAtSec ?? Number.POSITIVE_INFINITY;
    return aT - bT;
  });
  return flat;
}

// Delete a scheduled / queued / draft Buffer update by its id.
export async function destroyBufferUpdate(updateId: string): Promise<void> {
  const token = getBufferAccessToken();
  const res = await fetch(
    `${BUFFER_API_BASE}/updates/${encodeURIComponent(updateId)}/destroy.json?access_token=${encodeURIComponent(token)}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Buffer destroy failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { success?: boolean; message?: string };
  if (!json.success) {
    throw new Error(json.message ?? "Buffer destroy returned unsuccessful");
  }
}

// Flatten the language→platform map into a list of all profile IDs the
// user has wired up. Used by the pending-updates fanout.
export function allMappedProfileIds(map: BufferProfileMap): string[] {
  const ids: string[] = [];
  for (const lang of Object.keys(map)) {
    const entry = map[lang];
    if (!entry) continue;
    for (const platform of Object.keys(entry) as SocialPlatform[]) {
      const id = entry[platform];
      if (id) ids.push(id);
    }
  }
  return Array.from(new Set(ids));
}
