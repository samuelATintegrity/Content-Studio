import { NextResponse } from "next/server";
import {
  getBufferProfileMap,
  listBufferProfiles,
  type BufferProfileMap,
  type SocialPlatform,
} from "@/lib/bufferServer";
import type { Language } from "@/lib/types";

// Setup helper: returns every Buffer profile linked to the access token,
// the current language→platform mapping from the env var, AND a
// suggestedMap that pattern-matches each channel's display name to the
// most likely language so the user can paste a ready-to-go
// BUFFER_PROFILE_MAP_JSON into Vercel's env settings without hunting
// IDs by hand. Strictly read-only.
export const runtime = "nodejs";

const SUPPORTED_PLATFORMS: SocialPlatform[] = [
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
];

// Keywords (case-insensitive substring match) we look for in a channel's
// display name to assign it to a language. Order doesn't matter since
// we test all keywords; first match wins per channel.
const LANGUAGE_KEYWORDS: Record<Language, string[]> = {
  en: ["english", "en ", " en", "(en)", "[en]", "-en"],
  tl: ["tagalog", "filipino", "pinoy", "tl ", " tl", "(tl)", "[tl]", "-tl", "ph "],
  es: ["spanish", "español", "espanol", "es ", " es", "(es)", "[es]", "-es"],
  zh: ["mandarin", "chinese", "中文", "zh ", " zh", "(zh)", "[zh]", "-zh", "cn "],
};

function detectLanguage(displayName: string): Language | null {
  const lower = ` ${displayName.toLowerCase()} `; // pad so " en" matches at edges
  for (const lang of Object.keys(LANGUAGE_KEYWORDS) as Language[]) {
    for (const kw of LANGUAGE_KEYWORDS[lang]) {
      if (lower.includes(kw.toLowerCase())) return lang;
    }
  }
  return null;
}

function normalizeService(service: string): SocialPlatform | null {
  const s = service.toLowerCase();
  if (s.includes("facebook")) return "facebook";
  if (s.includes("instagram")) return "instagram";
  if (s.includes("tiktok")) return "tiktok";
  if (s.includes("youtube")) return "youtube";
  return null;
}

export async function GET() {
  try {
    const [profiles, currentMap] = await Promise.all([
      listBufferProfiles(),
      Promise.resolve(getBufferProfileMap()),
    ]);

    const slim = profiles.map((p) => ({
      id: p.id,
      service: p.service,
      username: p.formatted_username ?? p.service_username,
      type: p.service_type,
      detectedLanguage: detectLanguage(p.formatted_username ?? p.service_username ?? ""),
    }));

    // Build the suggested map. Start from whatever the user already has
    // (we never overwrite an existing assignment) and overlay any
    // language-detected channel IDs. Channels whose display name didn't
    // match any keyword surface in `unassignedProfiles` so the user
    // knows to label them manually.
    const suggestedMap: BufferProfileMap = {};
    for (const lang of Object.keys(currentMap) as Language[]) {
      suggestedMap[lang] = { ...(currentMap[lang] ?? {}) };
    }
    const unassignedProfiles: typeof slim = [];
    for (const p of slim) {
      const platform = normalizeService(p.service);
      if (!platform || !SUPPORTED_PLATFORMS.includes(platform)) continue;
      if (!p.detectedLanguage) {
        unassignedProfiles.push(p);
        continue;
      }
      const langKey = p.detectedLanguage;
      if (!suggestedMap[langKey]) suggestedMap[langKey] = {};
      // Don't clobber an existing mapping the user wrote by hand —
      // the suggestion is additive.
      if (!suggestedMap[langKey][platform]) {
        suggestedMap[langKey][platform] = p.id;
      }
    }

    return NextResponse.json({
      profiles: slim,
      currentMap,
      suggestedMap,
      // Compact one-line JSON so the user can copy-paste directly into
      // Vercel's env var input without manually flattening the pretty-
      // printed version.
      suggestedMapEnvValue: JSON.stringify(suggestedMap),
      unassignedProfiles,
      hint:
        "Paste `suggestedMapEnvValue` into BUFFER_PROFILE_MAP_JSON on Vercel, then redeploy. " +
        "Channels in `unassignedProfiles` need to be assigned manually — their display names " +
        "didn't include a recognizable language token (en/tl/es/zh) so we couldn't guess. " +
        "Build BUFFER_PROFILE_MAP_JSON like " +
        '{"en":{"facebook":"<id>","instagram":"<id>","tiktok":"<id>","youtube":"<id>"},"tl":{...}}.',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
