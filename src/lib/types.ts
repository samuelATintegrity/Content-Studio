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
  | "edu_physician_loans"
  | "edu_hero_loans"
  | "language_match"
  | "good_agents";

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  zero_down_generic: "$0 down — generic",
  edu_zero_down_usda_local: "Education: $0 down (USDA + local banks)",
  edu_dpa_local: "Education: Down payment assistance (local programs)",
  edu_physician_loans: "Education: Physician / medical professional loans",
  edu_hero_loans: "Education: Community-hero loans (nurses, first responders, teachers)",
  language_match: "Language match (agents/LOs who speak your language)",
  good_agents: "Good Agents (matching mission)",
};

export type Format = "static" | "video";

// DEPRECATED: kept only so old persisted Post records that carry this
// field still typecheck. The static UI no longer surfaces a sub-mode
// toggle — see StaticContentType below.
export type StaticSubMode = "photo" | "graphic";

// Graphic templates. The first three are hand-built SVG layouts (one
// SVG builder per template). "ai_poster" is the experimental escape
// hatch — Nano Banana Pro generates the entire 4:5 graphic from the
// post's copy + the brand logo as a reference image. Less predictable
// but produces visual variety the SVG templates can't.
export type GraphicTemplate = "stat" | "did_you_know" | "promo" | "ai_poster";

export const GRAPHIC_TEMPLATE_LABELS: Record<GraphicTemplate, string> = {
  stat: "Statistic",
  did_you_know: "Did you know",
  promo: "Promo",
  ai_poster: "AI poster",
};

// The single picker the static UI now exposes. "photo" runs the
// blended-content-type photo flow (12 cards across 4 topical content
// types); the four template values dispatch to the existing graphic
// flows untouched.
export type StaticContentType = "photo" | GraphicTemplate;

export const STATIC_CONTENT_TYPE_LABELS: Record<StaticContentType, string> = {
  photo: "Photo",
  stat: "Statistic",
  did_you_know: "Did you know",
  promo: "Promo",
  ai_poster: "AI poster",
};

// DEPRECATED — kept so any code still importing it compiles. New
// code should rely on DEFAULT_STATIC_CONTENT_TYPE below.
export const DEFAULT_STATIC_SUB_MODE: StaticSubMode = "photo";
export const DEFAULT_GRAPHIC_TEMPLATE: GraphicTemplate = "stat";
export const DEFAULT_STATIC_CONTENT_TYPE: StaticContentType = "photo";

// Per-template field shapes. Each template displays a different set of
// values, so we use a discriminated union keyed on template instead of
// a generic { headline, subline } that pretends one shape fits all.
export interface StatGraphicData {
  template: "stat";
  number: string;        // "73", "$58k", "4.7"
  unit: string;          // "%", " days", "★"
  statement: string;     // one-line context
  source: string;        // attribution line
  index?: string;        // "01", "02" — eyebrow counter (optional, default "01")
  palette?: PaletteKey;  // color palette; default "classic"
}

export interface DykGraphicData {
  template: "did_you_know";
  fact: string;          // 1-2 sentence headline
  body: string;          // 1-2 sentence elaboration
  index: string;         // "01", "02"
  palette?: PaletteKey;  // color palette; default "classic"
}

export interface PromoGraphicData {
  template: "promo";
  headline: string;       // catchphrase, 4-12 words, may render across 2-4 lines
  subline: string;        // single supporting sentence (~10-18 words)
  kicker?: string;        // optional small line above CTA, defaults to brand kicker
  palette?: PaletteKey;   // color palette; default "classic"
}

// AI poster v2 splits the old text-baked-into-Nano flow into three
// stages: (1) Claude writes the imagePrompt + copy + commits to a
// text zone, (2) Nano renders a bare image with the text zone left
// as calm negative space, (3) ImageResponse composites Geist-typeset
// headline/subline over the image with placement chosen by Claude
// Vision (using textZone as a strong hint). The imagePrompt is
// captured here so the route can hash it for R2 caching and so
// regen with the same image but different copy doesn't re-spend a
// Nano generation.
export type AiPosterTextZone = "top" | "bottom";

export type CompositeTextZone = "top" | "bottom";

// Color palettes for the Stat / DYK / Promo graphic templates. Each
// post defaults to the "classic" white-on-black palette but the user
// can flip to any of the others via the swatch row on the card. The
// palette key is persisted on the graphic data so re-rendering after
// a copy edit keeps the chosen colors.
//
// Palette anatomy:
//   bg       — card background (fills the 1080x1350 canvas)
//   ink      — primary headline / number / fact ink
//   mute     — secondary text (eyebrow, source line, body subtext)
//   rule     — accent rule (the 40-80px x 2-3px line under eyebrows)
//   wordmark — which logo variant to use ("black" or "white")
//
// Tuned by feel — light palettes pair near-black ink + neutral mutes;
// dark palettes pair cream ink + slightly desaturated mutes.
export type PaletteKey =
  | "classic"
  | "cream"
  | "pastel_pink"
  | "pastel_blue"
  | "deep_navy"
  | "forest";

export interface Palette {
  bg: string;
  ink: string;
  mute: string;
  rule: string;
  wordmark: "black" | "white";
}

export const PALETTES: Record<PaletteKey, Palette> = {
  classic:     { bg: "#FFFFFF", ink: "#000000", mute: "#9A9A9A", rule: "#000000", wordmark: "black" },
  cream:       { bg: "#F4EDE0", ink: "#1F1B16", mute: "#7B6E58", rule: "#1F1B16", wordmark: "black" },
  // Brighter Easter-egg pastels (2026-05-08). The old dusty pink/blue
  // (#F6D9D9 / #D7E3F0) read mauve and pale denim — pushed both into
  // candy / robin's-egg territory while keeping the ink contrast > 14:1
  // and the mute > 4.5:1 against the new bg for body legibility.
  pastel_pink: { bg: "#FFCAD4", ink: "#2D1620", mute: "#7A3F5C", rule: "#2D1620", wordmark: "black" },
  pastel_blue: { bg: "#BDE0FE", ink: "#0F2540", mute: "#2F5A88", rule: "#0F2540", wordmark: "black" },
  deep_navy:   { bg: "#102338", ink: "#F4EDE0", mute: "#A9B5C4", rule: "#F4EDE0", wordmark: "white" },
  forest:      { bg: "#1F3B2F", ink: "#F4EDE0", mute: "#A9B5A0", rule: "#F4EDE0", wordmark: "white" },
};

export const PALETTE_KEYS: PaletteKey[] = [
  "classic",
  "cream",
  "pastel_pink",
  "pastel_blue",
  "deep_navy",
  "forest",
];

export const DEFAULT_PALETTE: PaletteKey = "classic";

// Short user-facing labels for the swatches' a11y title.
export const PALETTE_LABELS: Record<PaletteKey, string> = {
  classic: "Classic",
  cream: "Cream",
  pastel_pink: "Pastel pink",
  pastel_blue: "Pastel blue",
  deep_navy: "Deep navy",
  forest: "Forest",
};

export interface PhotoCompositeData {
  template: "photo";
  headline: string;
  // Photo-post equivalent of the AI-poster subline: this is the
  // post's cta string ("Connect with an Agent"), reused as the
  // grouped supporting line below the headline. The photo route
  // wires post.cta in here at compose time.
  subline: string;
  // Public URL of the photo (Pexels, R2 cache, or fal.ai CDN).
  // The compose-graphic route fetches the bytes server-side and
  // base64-inlines them so Satori has a stable backgroundImage to
  // render against.
  photoUrl: string;
  // Where the headline + subline land on this card. Vision uses
  // this as a strong default and confirms or overrides based on
  // the actual photo.
  textZone: CompositeTextZone;
  // When true, suppress the headline + subline + halo and render
  // only the photo with the small Agent Match wordmark in the
  // bottom corner. The user toggles this with the Overlay ↔ Plain
  // chip on photo cards.
  plain?: boolean;
}

export interface AiPosterGraphicData {
  template: "ai_poster";
  headline: string;
  subline: string;
  imagePrompt: string;
  // Where Claude planned the text to land on THIS card. The image
  // prompt was written to leave this zone as calm negative space and
  // the subject placed in the opposite zone. Vision uses this as the
  // default when picking a final region.
  textZone: AiPosterTextZone;
  conceptKey?: string;  // which metaphor seed produced this card
}

export type GraphicData =
  | StatGraphicData
  | DykGraphicData
  | PromoGraphicData
  | AiPosterGraphicData
  | PhotoCompositeData;

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

// "branded" / "sepia" remain on the union for back-compat (old saved
// posts) but the UI no longer cycles to them — only Light ↔ Plain.
// Default to "light" because most posts read better with the typography
// overlay than as a bare photo; user can flip to Plain in one click.
export const DEFAULT_STYLE: StyleVariant = "light";

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
// New default: photo posts now always full-bleed cover. The "contain"
// (letterboxed) value is still on the union for back-compat with old
// saved posts, but the UI no longer lets users pick it.
export const DEFAULT_FIT_MODE: FitMode = "cover";

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
  // set, the renderer routes by template:
  //   stat        → React template (Light theme), per-field copy
  //   did_you_know → React template, per-field copy
  //   promo       → React template, canonical brand copy (no fields)
  //   ai_poster   → fal.ai Nano Banana Pro from headline + subline
  staticSubMode?: StaticSubMode;
  graphic?: GraphicData;
  // Stamped at batch dispatch so the Send-to-Buffer flow knows which
  // language's profile set to target. Undefined for older posts in
  // localStorage from before this field landed.
  language?: Language;
  // Each photo post in a blended batch carries its own topical
  // content type so per-post operations (Pexels query, AI image
  // seed, IG caption form-line) pull the right values regardless
  // of what's currently selected in the sidebar. Undefined on
  // graphic posts and on legacy single-content batches.
  contentType?: ContentType;
  // Where the typography lands on this card. For AI photos, this
  // also drives composition guidance baked into the Nano Banana 2
  // image prompt so the subject sits in the opposite zone. For
  // Pexels/library photos there's no upstream composition control,
  // but Vision still uses this as its placement default.
  textZone?: CompositeTextZone;
}

export interface BatchRequest {
  language: Language;
  contentType: ContentType;
  staticSubMode?: StaticSubMode;
}

export interface GenerateBatchResponse {
  posts: Array<
    Pick<Post, "angle" | "headline" | "cta" | "caption"> & {
      // Graphic-mode posts carry the template + per-template fields.
      // Undefined for photo posts so the existing static path stays
      // untouched.
      graphic?: GraphicData;
      // Stamped on photo-blend posts so each card pulls the right
      // Pexels query / AI prompt seed for its own topic. Undefined
      // on graphic posts and on legacy single-content batches.
      contentType?: ContentType;
      // Where Claude planned the typography on this card (photo
      // posts only). Drives composition guidance for AI image
      // prompts and Vision-placement default. Undefined on graphic
      // posts (which carry their own textZone inside `graphic`).
      textZone?: CompositeTextZone;
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

// Index into VIDEO_IMAGE_PROMPTS (0..4 — kitchen / entryway / bathroom /
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

// ── Funny Commercial workflow (v2 — storyboard) ──────────────────────
//
// Shot-based comedic ad builder. Pick (or generate) an actor whose
// canonical reference photo locks face identity across shots; build
// individual SHOTS by image-editing the actor or an absurd subject
// into a location, animate via Veo 3.1, then sequence shots on a
// timeline with optional text overlays + narration.
//
// Replaces the v1 fixed 4-scene template. The old `FcSceneImage`,
// `FcSceneVideo`, `FcPhrase`, `FcTranslatedPhrase`, `FcTheme`, `FcVisual`
// types are gone — manifest data persisted under the old slice names
// is silently dropped on load by `normalizeManifest`.

// An AI-generated actor with a canonical reference image used by Nano
// Banana for face consistency across every shot they appear in.
export interface FcActor {
  id: string;
  name: string;                 // user-editable label
  referenceImageUrl: string;    // canonical 9:16 portrait
  prompt: string;               // the text that produced them
  savedAt: number;
}

// A reusable backdrop / setting image. Locations are optional starter
// references for shot composition (Nano edits the actor or absurd
// subject INTO the location). Saved separately so they can be reused
// across multiple shots and multiple commercials.
export interface FcLocation {
  id: string;
  prompt: string;
  imageUrl: string;             // 9:16 background image
  savedAt: number;
}

// One scene-level beat in the storyboard. Each shot starts as a still
// (composed by Nano with optional reference images) and is animated to
// a 5-second clip by Veo 3.1. The last frame is extracted post-
// animation so the next actor shot can seed continuity from it.
export type FcShotKind = "actor" | "crazy";

export interface FcShot {
  id: string;
  kind: FcShotKind;
  actorId?: string;             // only when kind="actor"
  locationId?: string;          // optional starter location reference
  imagePrompt: string;          // composing prompt for the still
  imageUrl: string;             // first-frame still
  animationPrompt: string;      // Veo direction
  videoUrl?: string;            // populated after animation
  lastFrameImageUrl?: string;   // extracted post-animation for continuity
  parentShotId?: string;        // when seeded from another shot's last frame
  title?: string;               // user-editable label
  savedAt: number;
}

// One slot in the per-batch ordered timeline. Slots reference shots by
// id and may carry a text overlay + narration to render burned-in over
// the corresponding clip.
export interface FcTimelineItem {
  id: string;
  shotId: string;
  durationS?: number;           // optional trim override; default = clip duration
  overlay?: FcTimelineOverlay;
}

export interface FcTimelineOverlay {
  text: string;
  narrate: boolean;             // generate TTS for the overlay text?
  voiceId?: string;             // ElevenLabs voice; defaults to active-language voice
}

// What the FAB's render button produces.
export type FcRenderTarget = "mp4" | "premiere_zip";

// Render payload sent from app → worker (via /api/video/render). The
// worker concatenates clipUrls in order, burns overlays via ASS at the
// computed slot times, mixes narration audio at the slot start times,
// and appends the logo bumper.
export interface FcRenderTimelineItem {
  clipUrl: string;
  durationS?: number;
  overlay?: {
    text: string;
    narrationUrl?: string;      // pre-generated TTS, if narrate=true
    narrationDurationS?: number;
  };
}
