import { fal } from "@fal-ai/client";
import {
  VIDEO_ANIMATION_PROMPT,
  VIDEO_IMAGE_PROMPTS,
  VIDEO_IMAGE_STYLE_SUFFIX,
} from "./videoPrompts";
import type { VideoSourcePromptIndex } from "./types";

let _configured = false;
function configure() {
  if (_configured) return;
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY is not set in .env.local");
  fal.config({ credentials: key });
  _configured = true;
}

// Nano Banana 2 on fal.ai = Google Gemini 3.1 Flash Image.
const IMAGE_MODEL = "fal-ai/nano-banana-2";

// Nano Banana Pro on fal.ai = Google Gemini 3 Pro Image. Used by the
// "AI poster" graphic template — better at typography + designed
// graphics than the Flash model. Accepts reference images (image_urls)
// so we can pass our logo and ask it to incorporate the actual mark.
const IMAGE_MODEL_PRO = "fal-ai/nano-banana-pro";

// Seedance 2.0 image-to-video. Note: bytedance models on fal.ai live under
// the "bytedance/" namespace, not "fal-ai/" like Nano Banana.
const SEEDANCE_MODEL = "bytedance/seedance-2.0/image-to-video";

// Kling Video v3 Pro image-to-video. Used for the agent slot because
// Seedance's safety filter rejects most face-forward people shots while
// Kling animates them cleanly.
const KLING_MODEL = "fal-ai/kling-video/v3/pro/image-to-video";

// Google Veo 3.1 image-to-video. Stronger physics + native audio
// generation make it our default for the Funny Commercial flow where
// kinetic action and diegetic noise sell the gag (the muffled-through-
// the-wall Scene 2 audio is sampled from this output).
const VEO_MODEL = "fal-ai/veo3.1/image-to-video";

export type AnimationModel = "seedance" | "kling" | "veo";

const STATIC_STYLE_SUFFIX =
  ". Vertical 4:5 portrait orientation, taller than wide. Center the main subject with comfortable space above and below; the very top and bottom may be covered by text bars in some layouts, so do not place key subject matter in the top 16% or bottom 16% of the frame. Professional real estate photography style, photorealistic, natural daylight, sharp detail. No text, signs, or watermarks.";

// ── Funny Commercial v2 — Nano Banana with reference images ───────
//
// Used by every shot composition step in the storyboard rebuild:
//   - Generate a 9:16 actor portrait from a text prompt (no refs).
//   - Generate a 9:16 location backdrop from a text prompt (no refs).
//   - Compose a shot still with `actor reference + optional location`
//     in `referenceImageUrls` — Nano edits the actor INTO the
//     described scene with face consistency.
//   - Compose a "crazy" shot still with the location as the only
//     reference and the absurd subject described in the prompt.
//
// Nano Banana 2 (`fal-ai/nano-banana-2`) accepts an `image_urls` array
// for reference images. We always pass 9:16 + a no-text guardrail so
// the result is shot-ready.

const FC_NO_TEXT_SUFFIX =
  "ABSOLUTELY NO TEXT in the image. No letters, no words, no signs, no banners, no captions, no UI, no logos, no readable typography of any kind.";

interface FcImageInput {
  prompt: string;
  referenceImageUrls?: string[];
  aspectRatio?: "9:16" | "4:5" | "1:1" | "16:9";
}

export async function generateFcImage(args: FcImageInput): Promise<{ url: string }> {
  configure();
  const trimmed = args.prompt.trim().replace(/\.$/, "");
  const aspectRatio = args.aspectRatio ?? "9:16";
  const prompt = `${trimmed}. Vertical ${aspectRatio} orientation. Photorealistic. Cinematic lighting and composition. ${FC_NO_TEXT_SUFFIX}`;
  const input: Record<string, unknown> = {
    prompt,
    num_images: 1,
    output_format: "jpeg",
    aspect_ratio: aspectRatio,
  };
  if (args.referenceImageUrls && args.referenceImageUrls.length > 0) {
    input.image_urls = args.referenceImageUrls;
  }
  const result = await fal.subscribe(IMAGE_MODEL, {
    input: input as never,
    logs: false,
  });
  type FalImage = { url?: string };
  type FalData = { images?: FalImage[] };
  const data = (result as { data?: FalData }).data;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image URL");
  return { url };
}

// 4:5 image used by the static post pipeline.
export async function generateImage(userPrompt: string): Promise<{ url: string }> {
  configure();
  const prompt = userPrompt.trim().replace(/\.$/, "") + STATIC_STYLE_SUFFIX;

  const result = await fal.subscribe(IMAGE_MODEL, {
    input: {
      prompt,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: "4:5",
    },
    logs: false,
  });

  type FalImage = { url?: string };
  type FalData = { images?: FalImage[] };
  const data = (result as { data?: FalData }).data;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image URL");
  return { url };
}

// AI poster v2: image-only generation. Caller supplies a fully-formed
// scene description (no text, no UI, no signs); Nano Banana Pro renders
// the bare 4:5 visual and we composite typography ourselves with our
// own typography pipeline. Hard guardrails in the system suffix
// re-state "no text" because Gemini occasionally adds invented signage
// when the prompt mentions a building or scene that "would" have a
// label in real life. Returns the fal CDN URL.
export async function generateBareAiPoster(scenePrompt: string): Promise<{ url: string }> {
  configure();
  const trimmed = scenePrompt.trim().replace(/\.$/, "");
  const prompt = [
    trimmed + ".",
    "Vertical 4:5 portrait orientation, taller than wide.",
    "Cinematic, scroll-stopping composition. Strong focal subject. Considered lighting and color palette.",
    // Negative-text guardrail. Nano sometimes hallucinates signage,
    // license plates, captions, or scribbles even when not asked, so
    // we re-state this multiple ways.
    "ABSOLUTELY NO TEXT in the image. No letters, no words, no signs, no banners, no billboards, no captions, no UI, no logos, no watermarks, no readable typography of any kind. Pure visual only — text will be composited separately.",
  ].join(" ");

  const result = await fal.subscribe(IMAGE_MODEL_PRO, {
    input: {
      prompt,
      num_images: 1,
      output_format: "png",
      aspect_ratio: "4:5",
    } as never,
    logs: false,
  });
  type FalImage = { url?: string };
  type FalData = { images?: FalImage[] };
  const data = (result as { data?: FalData }).data;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no AI poster URL");
  return { url };
}

// Legacy v1 AI poster path — text was rendered inside the image by
// Nano. Kept so we can roll back if the v2 (bare image + composited
// text) flow regresses; nothing currently calls it. Delete once v2 is
// proven on the live site.
export async function generateAiPoster(args: {
  headline: string;
  subline: string;
  cta: string;
  brandName: string;
  // Color palette. backgroundHex is the canvas color (typically a soft
  // neutral). primaryHex is the brand mark + headline color. secondaryHex
  // and accentHex are pops + softer accents. logoTintHex is the color
  // the logo should be rendered in when it appears in the poster.
  backgroundHex: string;
  primaryHex: string;
  secondaryHex: string;
  accentHex: string;
  logoTintHex: string;
  logoUrl?: string;
}): Promise<{ url: string }> {
  configure();
  const {
    headline,
    subline,
    cta,
    brandName,
    backgroundHex,
    primaryHex,
    secondaryHex,
    accentHex,
    logoTintHex,
    logoUrl,
  } = args;

  // The prompt is intentionally explicit about: aspect, brand voice,
  // typographic hierarchy, color palette, and the no-photo constraint
  // so we get a poster (not a photorealistic scene with text on top).
  const prompt = [
    `Create a 4:5 portrait social media poster for "${brandName}", a real estate agent matching service.`,
    `Layout: large headline at the top half, supporting subline in the middle, a CTA button or band at the bottom.`,
    `Headline (set this exact text in a large display weight): "${headline}"`,
    `Subline (smaller, 1-2 lines): "${subline}"`,
    `CTA (in a button or band): "${cta}"`,
    `Use this brand palette:`,
    `  - Background canvas: ${backgroundHex} (warm beige cream — most of the poster is this color).`,
    `  - Primary accent: ${primaryHex} (deep teal — use for headline ink, the logo mark, and the CTA band).`,
    `  - Secondary accent: ${secondaryHex} (lighter teal — use for thin dividers or supporting accents).`,
    `  - Tertiary accent: ${accentHex} (warm peach — sparingly for visual variety).`,
    logoUrl
      ? `Include the brand logo (provided as the reference image) prominently in the upper portion of the poster. The logo MUST be rendered in solid ${logoTintHex} — do not change its shape, just recolor it to that exact deep teal hex. Do not redraw or stylize the mark; use the supplied geometry.`
      : `Include simple typographic branding "${brandName}" in solid ${logoTintHex} in the header area.`,
    `Style: clean, modern, minimal, designed graphic — NOT a photograph, NOT a photorealistic scene. Flat colors and typography only.`,
    `Render the typography crisply and accurately — no garbled letters, no random characters, no fake text.`,
    `No people, no houses, no photographs.`,
  ].join(" ");

  const input: Record<string, unknown> = {
    prompt,
    num_images: 1,
    output_format: "png",
    aspect_ratio: "4:5",
  };
  if (logoUrl) {
    input.image_urls = [logoUrl];
  }

  const result = await fal.subscribe(IMAGE_MODEL_PRO, { input: input as never, logs: false });
  type FalImage = { url?: string };
  type FalData = { images?: FalImage[] };
  const data = (result as { data?: FalData }).data;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no AI poster URL");
  return { url };
}

// 9:16 image used as the source frame for one of the 5 video slots. Picks
// the prompt by index from the fixed list; appends a vertical-orientation
// style suffix and asks for a fresh seed each call.
export async function generateVideoSourceImage(
  promptIndex: VideoSourcePromptIndex,
): Promise<{ url: string }> {
  configure();
  const base = VIDEO_IMAGE_PROMPTS[promptIndex];
  if (!base) throw new Error(`Invalid promptIndex: ${promptIndex}`);
  const prompt = base.trim().replace(/\.$/, "") + VIDEO_IMAGE_STYLE_SUFFIX;

  const result = await fal.subscribe(IMAGE_MODEL, {
    input: {
      prompt,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: "9:16",
    },
    logs: false,
  });

  type FalImage = { url?: string };
  type FalData = { images?: FalImage[] };
  const data = (result as { data?: FalData }).data;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image URL");
  return { url };
}

// 9:16 image with a user-supplied prompt — for the manual "Generate AI clip"
// flow in the library picker. Same model + style suffix as the slot generator
// so the resulting frame matches the rest of the library visually.
export async function generateCustomVideoImage(userPrompt: string): Promise<{ url: string }> {
  configure();
  const trimmed = userPrompt.trim();
  if (!trimmed) throw new Error("prompt is required");
  const prompt = trimmed.replace(/\.$/, "") + VIDEO_IMAGE_STYLE_SUFFIX;

  const result = await fal.subscribe(IMAGE_MODEL, {
    input: {
      prompt,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: "9:16",
    },
    logs: false,
  });

  type FalImage = { url?: string };
  type FalData = { images?: FalImage[] };
  const data = (result as { data?: FalData }).data;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image URL");
  return { url };
}

type FalVideoFile = { url?: string };
type FalVideoData = { video?: FalVideoFile };

function extractVideoUrl(result: unknown): string {
  const data = (result as { data?: FalVideoData }).data;
  const url = data?.video?.url;
  if (!url) throw new Error("fal.ai returned no video URL");
  return url;
}

async function callAnimationModel(
  model: AnimationModel,
  imageUrl: string,
  prompt: string,
): Promise<string> {
  if (model === "veo") {
    // Veo 3.1 image-to-video: vertical 9:16, audio enabled by default
    // (the funny-commercial flow relies on the diegetic audio being
    // present so the worker can lowpass-loop it under Scene 2).
    const veoInput = {
      image_url: imageUrl,
      prompt,
      aspect_ratio: "9:16",
      duration: "5s",
      generate_audio: true,
    };
    const result = await fal.subscribe(VEO_MODEL, {
      input: veoInput as never,
      logs: false,
    });
    return extractVideoUrl(result);
  }
  if (model === "kling") {
    const klingInput = {
      start_image_url: imageUrl,
      prompt,
      duration: "5",
      generate_audio: false,
    };
    const result = await fal.subscribe(KLING_MODEL, {
      input: klingInput as never,
      logs: false,
    });
    return extractVideoUrl(result);
  }
  const seedanceInput = {
    image_url: imageUrl,
    prompt,
    aspect_ratio: "9:16",
    duration: 5,
    resolution: "1080p",
    generate_audio: false,
  };
  const result = await fal.subscribe(SEEDANCE_MODEL, {
    input: seedanceInput as never,
    logs: false,
  });
  return extractVideoUrl(result);
}

// Heuristic: did Seedance refuse the input on content / safety grounds?
// fal SDK errors surface in a few shapes (status, message, body.detail);
// we check all of them to be robust.
function looksLikeSafetyOr422(e: unknown): boolean {
  if (!e) return false;
  const obj = e as { status?: number; message?: string; body?: { detail?: unknown } };
  if (obj.status === 422) return true;
  const msg = (obj.message ?? "").toLowerCase();
  if (msg.includes("422") || msg.includes("unprocessable")) return true;
  const detailRaw = obj.body?.detail;
  const detail = typeof detailRaw === "string" ? detailRaw : JSON.stringify(detailRaw ?? "");
  const d = detail.toLowerCase();
  if (d.includes("safety") || d.includes("content") || d.includes("likeness")) return true;
  return false;
}

// Animate a still image. 5s duration fixed.
// Routing:
//   - "seedance"  default for narration / influencer flows. Sharp, 1080p, no audio.
//   - "kling"     used for caller-marked people slots (no face restriction).
//   - "veo"       Funny Commercial flow. Generates audio. STRICTER likeness
//                 filter than Seedance — rejects images with identifiable
//                 real people more often than expected.
// Safety net: if the chosen model rejects with a 422 / safety error we
// automatically retry once via Kling, which has no documented face
// restriction. Catches both forgotten routings and stale client builds
// that didn't pass the model field, AND Veo's tighter likeness filter
// when the user feeds it a photoreal portrait.
//
// `animationPrompt` overrides the default "subtle camera movement…" prompt
// (used by the from-scratch flow + manual AI clip generator). Falls back to
// VIDEO_ANIMATION_PROMPT when not supplied.
export async function animateImage(
  imageUrl: string,
  model: AnimationModel = "seedance",
  animationPrompt?: string,
): Promise<{ url: string }> {
  configure();
  if (!imageUrl) throw new Error("animateImage: imageUrl required");

  const prompt = animationPrompt?.trim() || VIDEO_ANIMATION_PROMPT;

  try {
    const url = await callAnimationModel(model, imageUrl, prompt);
    return { url };
  } catch (e) {
    if ((model === "seedance" || model === "veo") && looksLikeSafetyOr422(e)) {
      console.warn(
        `[animateImage] ${model} refused with safety/422 — retrying with Kling.`,
        e instanceof Error ? e.message : String(e),
      );
      const url = await callAnimationModel("kling", imageUrl, prompt);
      return { url };
    }
    throw e;
  }
}
