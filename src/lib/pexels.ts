import type { ContentType } from "./types";

const PEXELS_API = "https://api.pexels.com/v1/search";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    portrait: string;
  };
}

interface PexelsResponse {
  photos: PexelsPhoto[];
  total_results?: number;
}

// Three tiers per content type. We start with the most on-topic queries; if those
// can't find any un-used photos we widen to broader queries; the global FALLBACK
// is a last resort that almost guarantees novel results.
const QUERIES: Record<ContentType, { primary: string[]; broad: string[] }> = {
  zero_down_generic: {
    primary: [
      "modern home exterior",
      "suburban house front",
      "new home keys",
      "young family at home",
      "couple in new home",
    ],
    broad: [
      "american house",
      "single family home",
      "house front porch",
      "couple unpacking home",
      "family kitchen together",
      "young couple home keys",
      "happy family new home",
    ],
  },
  edu_zero_down_usda_local: {
    primary: [
      "rural home exterior",
      "country house porch",
      "farmhouse exterior",
      "family rural home",
      "couple country home",
    ],
    broad: [
      "countryside home",
      "small town house",
      "rural neighborhood",
      "ranch style house",
      "family farmhouse",
      "couple country living room",
    ],
  },
  edu_dpa_local: {
    primary: [
      "family in front of house",
      "first time homebuyer",
      "couple house keys",
      "young family at home",
      "couple unpacking new home",
    ],
    broad: [
      "family moving in",
      "happy homeowner",
      "young family home",
      "homebuyer signing",
      "couple living room together",
      "family kitchen breakfast",
      "couple new house celebration",
    ],
  },
  edu_physician_loans: {
    primary: [
      "doctor home keys",
      "physician new home",
      "medical professional home",
      "young doctor with stethoscope",
      "couple in scrubs at home",
    ],
    broad: [
      "doctor outside hospital",
      "medical professional smiling",
      "physician family home",
      "healthcare worker home",
      "couple buying home",
    ],
  },
  edu_hero_loans: {
    primary: [
      "firefighter home keys",
      "nurse smiling outside home",
      "police officer family",
      "teacher in front of house",
      "first responder family",
    ],
    broad: [
      "community helper",
      "first responder portrait",
      "nurse in scrubs",
      "teacher classroom portrait",
      "firefighter portrait",
      "family in front of home",
    ],
  },
  language_match: {
    primary: [
      "family home keys",
      "diverse family home",
      "home buyer handshake",
      "diverse couple at home",
      "multicultural family living room",
    ],
    broad: [
      "multicultural family",
      "family front yard",
      "homebuyer agent meeting",
      "family new home",
      "diverse couple kitchen",
      "family three generations home",
    ],
  },
  good_agents: {
    primary: [
      "real estate agent handshake",
      "real estate agent meeting",
      "professional real estate agent",
    ],
    broad: [
      "agent client home tour",
      "real estate consultation",
      "real estate office meeting",
      "agent showing house",
      "agent meeting family",
      "agent with couple at home",
    ],
  },
};

const FALLBACK = [
  "house exterior",
  "residential home",
  "neighborhood home",
  "real estate property",
  "home for sale",
  "family at home",
  "couple at home",
  "family living room",
];

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function fetchPexelsPage(query: string, key: string): Promise<PexelsPhoto[]> {
  const url = new URL(PEXELS_API);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", "30");
  url.searchParams.set("page", String(1 + Math.floor(Math.random() * 5)));
  const res = await fetch(url, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Pexels error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as PexelsResponse;
  return data.photos ?? [];
}

export async function fetchPhoto(
  contentType: ContentType,
  excludeIds: Set<number> = new Set(),
): Promise<{ url: string; id: number; photographer: string; sourceUrl: string }> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) throw new Error("PEXELS_API_KEY is not set in .env.local");

  const tiers: string[][] = [
    shuffle(QUERIES[contentType].primary),
    shuffle(QUERIES[contentType].broad),
    shuffle(FALLBACK),
  ];

  let lastTierPhotos: PexelsPhoto[] = [];
  for (const tier of tiers) {
    for (const query of tier) {
      const photos = await fetchPexelsPage(query, key);
      lastTierPhotos = photos;
      const candidates = photos.filter((p) => !excludeIds.has(p.id));
      if (candidates.length > 0) {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        return {
          url: chosen.src.large2x,
          id: chosen.id,
          photographer: chosen.photographer,
          sourceUrl: chosen.url,
        };
      }
    }
  }

  // Pool genuinely exhausted across all tiers and queries: return any photo from
  // the last query rather than failing. The user can keep clicking ↻ Image and
  // we'll eventually surface fresh ones as Pexels paginates differently.
  if (lastTierPhotos.length === 0) {
    throw new Error("Pexels returned no photos for any query in this content type");
  }
  const chosen = lastTierPhotos[Math.floor(Math.random() * lastTierPhotos.length)];
  return {
    url: chosen.src.large2x,
    id: chosen.id,
    photographer: chosen.photographer,
    sourceUrl: chosen.url,
  };
}
