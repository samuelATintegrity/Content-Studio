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

// Create a Buffer "update" (queued post) on one or more profiles. Buffer
// stages the post in the user's drafts/queue per-profile; the user opens
// Buffer to schedule + publish. Video URL must be publicly accessible
// (R2 URLs work). Throws on Buffer-side error.
export async function createBufferUpdate(args: {
  profileIds: string[];
  text: string;
  videoUrl: string;
  thumbnailUrl?: string;
  // When true, post is added to the queue at Buffer's next available slot.
  // Default: false → post stays in drafts so the user must schedule + send.
  shareNow?: boolean;
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
  if (args.shareNow) form.append("now", "true");
  // Otherwise the post lands in the "drafts" tab; the user reviews + schedules
  // in Buffer's UI.

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
