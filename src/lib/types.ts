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

// Static-format sub-modes. "photo" is the original photo + text-bands
// composition; "graphic" is the hand-built SVG template lane (stat
// callouts, did-you-know cards, brand promos).
export type StaticSubMode = "photo" | "graphic";

// Hand-built graphic templates. Each renders a different SVG layout
// from the same { headline, subline, cta } field shape.
export type GraphicTemplate = "stat" | "did_you_know" | "promo";

export const DEFAULT_STATIC_SUB_MODE: StaticSubMode = "photo";

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
  // Graphic-mode fields. Undefined for the standard photo flow. When
  // set, the renderer skips photo + text-bands and produces an SVG
  // template instead (stat callout, did-you-know, promo).
  staticSubMode?: StaticSubMode;
  graphic?: {
    template: GraphicTemplate;
    headline: string;
    subline: string;
    cta: string;
  };
}

export interface BatchRequest {
  language: Language;
  contentType: ContentType;
  staticSubMode?: StaticSubMode;
}

export interface GenerateBatchResponse {
  posts: Array<
    Pick<Post, "angle" | "headline" | "cta" | "caption"> & {
      // Graphic-mode posts include the template + all three layout
      // fields. Undefined for photo posts so the existing static
      // path stays untouched.
      graphic?: {
        template: GraphicTemplate;
        headline: string;
        subline: string;
        cta: string;
      };
    }
  >;
}

// ── Video workflow ───────────────────────────────────────────────────

// State of a single image slot in the per-batch image set. The pipeline
// generates → user approves → animates → ready, gated on user approval.
export type ImageSlotState =
  | "queued"
  | "generating"
  | "awaiting_approval"
  | "animating"
  | "video_ready"
  | "failed";

// Index into VIDEO_IMAGE_PROMPTS (0..4 — kitchen / bedroom / bathroom /
// exterior / agent). Used for choosing prompts and animation models.
export type VideoSourcePromptIndex = 0 | 1 | 2 | 3 | 4;

export interface ImageSlot {
  // Position in the rendered video's scene order. 0..4 for from-scratch
  // (5-clip) batches, 0..7 for the picked + AI mixed flow. The store keys
  // updates by this index.
  promptIndex: number;
  // How this slot's content was sourced. "ai" runs the standard generate →
  // approve → animate flow; "library" is pre-populated from a user pick
  // and shows up as video_ready immediately.
  source: "ai" | "library";
  // Only for source === "ai": which of the 5 from-scratch prompts to use.
  // For mixed-flow AI fills this cycles starting from 0 across the AI
  // slots, so each AI fill picks a different scene category.
  aiPromptIndex?: VideoSourcePromptIndex;
  state: ImageSlotState;
  imageUrl?: string;     // last-generated image (Nano Banana 2)
  videoUrl?: string;     // animated clip (Seedance) once approved
  error?: string;
}

export type VideoJobState =
  | "waiting_images"      // image set still in progress; render hasn't dispatched
  | "queued"
  | "tts"
  | "footage"
  | "rendering"
  | "uploading"
  | "ready"
  | "failed";

export type VideoMode = "narration" | "influencer";

// Influencer-mode messaging theme. Each theme has its own pre-recorded
// intro/outro clips and its own middle-script generation prompt. Existing
// agent_match clips are the matching-mission script ("connect with the
// best"); dpa is the down-payment-assistance/$0-down angle.
export type MessageTheme = "agent_match" | "dpa";

export const MESSAGE_THEME_LABELS: Record<MessageTheme, string> = {
  agent_match: "Agent Match mission",
  dpa: "$0 down / DPA",
};

export const DEFAULT_MESSAGE_THEME: MessageTheme = "agent_match";

export interface VideoPost {
  id: string;
  angle: string;
  script: string;        // narration text sent to ElevenLabs
  caption: string;       // full IG caption (URL + form line + body)
  jobId: string | null;  // Railway worker job id, null while waiting for images
  state: VideoJobState;
  progress: number;      // 0..1
  videoUrl?: string;     // R2 public URL once ready
  durationS?: number;
  error?: string;
  // Influencer-mode fields. Undefined for the standard narration flow.
  mode?: VideoMode;
  avatarName?: string;
  introClipUrl?: string;
  outroClipUrl?: string;
  messageTheme?: MessageTheme;
  // Captured at render dispatch so the social-relay action knows which
  // language's Buffer profiles (FB / IG / TikTok) to push to. Optional
  // for backward compat with posts already in localStorage.
  language?: Language;
}

// /api/video/start now only returns the 3 scripts. Render dispatch happens
// later, once the image set is approved + animated.
export interface VideoStartResponse {
  scripts: Array<{
    angle: string;
    script: string;
    caption: string;
  }>;
}

export interface VideoStatusResponse {
  state: VideoJobState;
  progress: number;
  videoUrl?: string;
  durationS?: number;
  error?: string;
}
