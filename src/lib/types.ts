export type Language = "en" | "tl" | "es" | "zh";

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  tl: "Tagalog",
  es: "Spanish",
  zh: "Mandarin (Simplified)",
};

export type ContentType =
  | "zero_down_generic"
  | "edu_zero_down_usda_local"
  | "edu_dpa_local"
  | "language_match"
  | "good_agents";

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  zero_down_generic: "$0 down — generic",
  edu_zero_down_usda_local: "Education: $0 down (USDA + local banks)",
  edu_dpa_local: "Education: Down payment assistance (local programs)",
  language_match: "Language match (agents/LOs who speak your language)",
  good_agents: "Good Agents (matching mission)",
};

export type Format = "static" | "video";

export const FORMAT_LABELS: Record<Format, string> = {
  static: "Static · 4:5",
  video: "Video · 9:16",
};

export const DEFAULT_FORMAT: Format = "static";

export type FontVariant = "sans" | "serif";

export type StyleVariant = "branded" | "light" | "sepia" | "plain";

export const STYLE_LABELS: Record<StyleVariant, string> = {
  branded: "Branded",
  light: "Light",
  sepia: "Sepia",
  plain: "Plain",
};

export const DEFAULT_STYLE: StyleVariant = "branded";

// "cover": photo fills the region, may crop (uses framing as percent of headroom).
// "contain": full photo visible, brand-color side bars fill any extra space.
// "manual": free placement — photo at any scale, freely positioned, no clamping.
//           framing.x and y are pixel offsets in canvas coords; scale is multiplier
//           on natural cover-fit size (1.0 = exact cover, <1 shrinks, >1 zooms).
export type FitMode = "cover" | "contain" | "manual";

// Framing values are interpreted differently per FitMode (see above).
export interface Framing {
  x: number;
  y: number;
  scale: number;
}

export const DEFAULT_FRAMING: Framing = { x: 0, y: 0, scale: 1.0 };
export const DEFAULT_FIT_MODE: FitMode = "contain";

export interface Post {
  id: string;
  angle: string;       // internal label, e.g. "myth_bust"
  headline: string;    // top band text, ≤ ~4 words
  cta: string;         // bottom band text, ≤ ~6 words
  caption: string;     // paragraph for IG caption
  photoUrl: string;    // remote URL of selected stock photo
  photoCredit?: { photographer: string; sourceUrl: string };
  imageDataUrl?: string; // composed PNG as data URL for preview/download
  fontVariant: FontVariant;
  framing: Framing;
  fitMode: FitMode;
  style: StyleVariant;
}

export interface BatchRequest {
  language: Language;
  contentType: ContentType;
}

export interface GenerateBatchResponse {
  posts: Array<Pick<Post, "angle" | "headline" | "cta" | "caption">>;
}
