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

// Video b-roll queries focus on PLACES — interiors, exteriors, neighborhoods,
// architecture, home tours. People-centric queries are deliberately excluded;
// the narration carries the human angle, the visuals stay on real estate.
const VIDEO_QUERIES: Record<ContentType, { primary: string[]; broad: string[] }> = {
  zero_down_generic: {
    primary: [
      "modern home exterior",
      "modern home interior tour",
      "luxury kitchen interior",
      "open concept living room",
      "suburban home tour",
      "house exterior daytime",
    ],
    broad: [
      "home walkthrough",
      "modern living room empty",
      "kitchen home tour",
      "suburban neighborhood houses",
      "house front porch",
      "interior design home",
      "real estate home tour",
    ],
  },
  edu_zero_down_usda_local: {
    primary: [
      "rural house exterior",
      "country house tour",
      "farmhouse exterior",
      "countryside home",
      "rural neighborhood",
      "ranch house exterior",
    ],
    broad: [
      "small town house",
      "country kitchen interior",
      "farmhouse living room empty",
      "rural landscape home",
      "ranch style interior",
      "wooded property home",
    ],
  },
  edu_dpa_local: {
    primary: [
      "starter home exterior",
      "first home tour",
      "modest home interior",
      "townhouse exterior",
      "small home walkthrough",
      "new construction home",
    ],
    broad: [
      "home keys close up",
      "front door home",
      "for sale sign yard",
      "home interior empty",
      "real estate house",
      "moving boxes empty home",
    ],
  },
  language_match: {
    primary: [
      "modern home exterior",
      "home interior tour",
      "neighborhood houses",
      "open kitchen home",
      "house front entrance",
      "real estate property",
    ],
    broad: [
      "suburban home street",
      "living room interior",
      "home walkthrough",
      "modern home design",
      "property exterior",
    ],
  },
  good_agents: {
    primary: [
      "modern home exterior",
      "luxury home tour",
      "real estate property",
      "home interior walkthrough",
      "open house empty",
      "house exterior architecture",
    ],
    broad: [
      "home for sale exterior",
      "modern interior design",
      "neighborhood homes street",
      "property tour",
      "kitchen home interior",
      "front yard house",
    ],
  },
};

const FALLBACK = [
  "modern home exterior",
  "home interior tour",
  "kitchen home",
  "living room interior",
  "house exterior",
  "neighborhood houses",
  "real estate property",
  "home walkthrough",
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

// Pexels video URLs include a slug describing the subject, e.g.
//   https://www.pexels.com/video/aerial-view-of-the-sydney-opera-house-12345/
// If any token in the slug is a known landmark / non-residential subject,
// we reject the video. This is a coarse filter — false positives are
// possible (e.g. "lakeshore-home" → reject because of "lake") — but the
// list is biased toward unambiguous non-home subjects.
const REJECT_TOKENS = new Set([
  // Famous landmarks
  "opera", "sydney", "eiffel", "louvre", "colosseum", "kremlin", "pyramid",
  // Civic / religious / institutional
  "stadium", "monument", "cathedral", "basilica", "church", "temple",
  "mosque", "synagogue", "shrine", "palace", "castle", "fortress",
  "library", "museum", "university", "school", "hospital", "courthouse",
  // City-scale views (not residential)
  "skyline", "skyscraper", "downtown", "cityscape", "metropolis",
  // Transport
  "airport", "airplane", "plane", "helicopter", "train", "subway",
  "metro", "cruise", "yacht", "ship", "harbor", "harbour", "dock", "port",
  // Industrial / commercial
  "factory", "warehouse", "mall", "office", "tower", "industrial",
  // Nature (not relevant to home content)
  "volcano", "desert", "jungle", "glacier", "canyon",
  // Vehicles
  "car", "truck", "motorcycle",
]);

function looksLikeReject(v: PexelsVideo): boolean {
  // Tokenise the URL on slashes and hyphens to extract slug words.
  const tokens = v.url.toLowerCase().split(/[/\-_]/);
  for (const t of tokens) {
    if (REJECT_TOKENS.has(t)) return true;
  }
  return false;
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
  minClipDurationS = 3,
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
  // Reject clips shorter than minClipDurationS so the per-clip ffmpeg trim
  // window doesn't undershoot and produce a visual track shorter than audio.
  // Also reject videos whose URL slug points at landmarks / non-residential
  // subjects — Pexels' search is fuzzy and "house exterior" sometimes
  // surfaces things like the Sydney Opera House.
  for (const tier of tiers) {
    for (const query of tier) {
      if (candidates.length >= count) break;
      try {
        const videos = await searchVideos(query, key);
        for (const v of videos) {
          if (usedIds.has(v.id)) continue;
          if (v.duration < minClipDurationS) continue;
          if (looksLikeReject(v)) continue;
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

  // If strict minimum yielded too few, retry with a relaxed minimum so the
  // pipeline still produces something rather than failing outright. The
  // landmark filter still applies — we'd rather have fewer clips than a
  // skyscraper in a home-buyer video.
  if (candidates.length < count && minClipDurationS > 3) {
    for (const tier of tiers) {
      for (const query of tier) {
        if (candidates.length >= count) break;
        try {
          const videos = await searchVideos(query, key);
          for (const v of videos) {
            if (usedIds.has(v.id)) continue;
            if (v.duration < 3) continue;
            if (looksLikeReject(v)) continue;
            usedIds.add(v.id);
            candidates.push(v);
            if (candidates.length >= count) break;
          }
        } catch {
          // ignore
        }
      }
      if (candidates.length >= count) break;
    }
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
