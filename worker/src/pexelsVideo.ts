// Pexels Videos search + download. Returns N downloaded portrait clips that
// the ffmpeg stage can scale/crop/concat into a 9:16 final.

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import type { ContentType } from "./types.js";

const PEXELS_VIDEOS_API = "https://api.pexels.com/videos/search";

interface PexelsVideoFile {
  id: number;
  quality: "hd" | "sd" | string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  video_files: PexelsVideoFile[];
}

interface PexelsSearchResponse {
  videos: PexelsVideo[];
}

export interface FootageClip {
  filePath: string;
  pexelsId: number;
  durationS: number;
}

// Video b-roll queries lean on home interiors and lifestyle, since the
// narration is spoken-over-visuals and viewers expect to see what's being
// described (homes, families, agents) rather than static exteriors.
const VIDEO_QUERIES: Record<ContentType, { primary: string[]; broad: string[] }> = {
  zero_down_generic: {
    primary: [
      "modern home interior",
      "family living room",
      "couple new home",
      "kitchen home tour",
      "house keys handover",
    ],
    broad: [
      "home tour",
      "real estate house",
      "family at home",
      "couple moving in",
      "home walkthrough",
      "home interior tour",
    ],
  },
  edu_zero_down_usda_local: {
    primary: [
      "rural home",
      "country house interior",
      "farmhouse interior",
      "family rural home",
      "countryside living room",
    ],
    broad: [
      "small town home",
      "ranch house interior",
      "country kitchen",
      "rural family home",
      "farmhouse living room",
    ],
  },
  edu_dpa_local: {
    primary: [
      "first time homebuyer",
      "couple new home keys",
      "family moving in",
      "couple house tour",
      "young family home",
    ],
    broad: [
      "homebuyer signing",
      "couple unpacking home",
      "family kitchen breakfast",
      "couple living room",
      "happy homeowner",
    ],
  },
  language_match: {
    primary: [
      "diverse family home",
      "multicultural family living room",
      "diverse couple home",
      "family home tour",
      "agent diverse family",
    ],
    broad: [
      "family front yard",
      "family three generations home",
      "diverse couple kitchen",
      "multicultural household",
      "family new home",
    ],
  },
  good_agents: {
    primary: [
      "real estate agent meeting",
      "real estate agent handshake",
      "agent client home tour",
      "professional real estate agent",
      "agent showing house",
    ],
    broad: [
      "real estate consultation",
      "agent meeting family",
      "real estate office",
      "agent with couple at home",
      "open house agent",
    ],
  },
};

const FALLBACK = [
  "home interior",
  "family at home",
  "couple at home",
  "modern living room",
  "house tour",
  "real estate home",
];

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

// Among a video's encoded files, pick the one closest to but not exceeding
// 1920px tall — we're cropping to 1080x1920 anyway, so larger is wasted bytes.
// Falls back to the largest available portrait/landscape mp4 if nothing fits.
function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  const mp4s = files.filter((f) => f.file_type === "video/mp4" && f.width > 0 && f.height > 0);
  if (mp4s.length === 0) return null;

  const portrait = mp4s.filter((f) => f.height >= f.width);
  const pool = portrait.length > 0 ? portrait : mp4s;

  // Prefer >=1080 wide, >=1920 tall; pick the smallest qualifying one.
  const qualifying = pool
    .filter((f) => f.width >= 1080 && f.height >= 1920)
    .sort((a, b) => a.width * a.height - b.width * b.height);
  if (qualifying[0]) return qualifying[0];

  // Otherwise pick the largest available — better to upscale than fail.
  const sorted = [...pool].sort((a, b) => b.width * b.height - a.width * a.height);
  return sorted[0] ?? null;
}

async function searchVideos(query: string, key: string): Promise<PexelsVideo[]> {
  const url = new URL(PEXELS_VIDEOS_API);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", "15");
  url.searchParams.set("page", String(1 + Math.floor(Math.random() * 3)));
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) {
    throw new Error(`Pexels Videos error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as PexelsSearchResponse;
  return data.videos ?? [];
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url} (${res.status})`);
  }
  const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(stream, createWriteStream(dest));
}

export async function fetchFootage(
  contentType: ContentType,
  count: number,
  outDir: string,
): Promise<FootageClip[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("PEXELS_API_KEY is not set");
  if (count <= 0) return [];

  const tiers: string[][] = [
    shuffle(VIDEO_QUERIES[contentType].primary),
    shuffle(VIDEO_QUERIES[contentType].broad),
    shuffle(FALLBACK),
  ];

  const usedIds = new Set<number>();
  const candidates: PexelsVideo[] = [];

  // Walk tiers until we have at least `count` distinct candidates. We may end
  // up with more — that's fine, the caller picks the first `count`.
  for (const tier of tiers) {
    for (const query of tier) {
      if (candidates.length >= count) break;
      try {
        const videos = await searchVideos(query, key);
        for (const v of videos) {
          if (usedIds.has(v.id)) continue;
          if (v.duration < 3) continue; // too short to be useful for trim
          usedIds.add(v.id);
          candidates.push(v);
          if (candidates.length >= count) break;
        }
      } catch (e) {
        // Soft-fail single queries; only the outer loop's exhaustion is fatal.
        console.warn(`pexels search failed for "${query}":`, (e as Error).message);
      }
    }
    if (candidates.length >= count) break;
  }

  if (candidates.length === 0) {
    throw new Error("Pexels Videos returned no usable clips for any query");
  }

  // Download the chosen N (or as many as we got) in parallel.
  const chosen = candidates.slice(0, count);
  const downloads = chosen.map(async (v, i) => {
    const file = pickBestFile(v.video_files);
    if (!file) throw new Error(`No usable mp4 for Pexels video ${v.id}`);
    const filePath = join(outDir, `clip-${i}.mp4`);
    await downloadFile(file.link, filePath);
    return { filePath, pexelsId: v.id, durationS: v.duration } satisfies FootageClip;
  });

  return Promise.all(downloads);
}
