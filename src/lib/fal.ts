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

export type AnimationModel = "seedance" | "kling";

const STATIC_STYLE_SUFFIX =
  ". Vertical 4:5 portrait orientation, taller than wide. Center the main subject with comfortable space above and below; the very top and bottom may be covered by text bars in some layouts, so do not place key subject matter in the top 16% or bottom 16% of the frame. Professional real estate photography style, photorealistic, natural daylight, sharp detail. No text, signs, or watermarks.";

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

// Generate a 4:5 designed-graphic poster via Nano Banana Pro. The
// caller supplies copy fields (headline / subline / cta) and a public
// URL to the brand logo (passed as a reference image so the actual
// mark appears, not a hallucinated lookalike). Returns the fal-hosted
// image URL.
export async function generateAiPoster(args: {
  headline: string;
  subline: string;
  cta: string;
  brandName: string;
  primaryHex: string;
  accentHex: string;
  logoUrl?: string;
}): Promise<{ url: string }> {
  configure();
  const { headline, subline, cta, brandName, primaryHex, accentHex, logoUrl } = args;

  // The prompt is intentionally explicit about: aspect, brand voice,
  // typographic hierarchy, color palette, and the no-photo constraint
  // so we get a poster (not a photorealistic scene with text on top).
  const prompt = [
    `Create a 4:5 portrait social media poster for "${brandName}", a real estate agent matching service.`,
    `Layout: large headline at the top half, supporting subline in the middle, a CTA button or band at the bottom.`,
    `Headline (set this exact text in a large display weight): "${headline}"`,
    `Subline (smaller, 1-2 lines): "${subline}"`,
    `CTA (in a button or band): "${cta}"`,
    `Brand colors: primary ${primaryHex} (use for the dominant background or band), accent ${accentHex} for highlights, white text on dark backgrounds.`,
    logoUrl
      ? `Include the brand logo (provided as a reference image) prominently and clearly — do not redraw it, use the supplied mark.`
      : `Include simple typographic branding for "${brandName}" in the header area.`,
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

// Animate a still image with subtle camera movement. 5s duration fixed.
// Routes to Seedance by default (sharper, supports 1080p) and to Kling for
// caller-marked people slots. As a safety net, if Seedance rejects with a
// 422 / safety error we automatically retry once via Kling — Kling has no
// documented face restriction, so this catches both forgotten routings and
// stale client builds that didn't pass the model field.
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
    if (model === "seedance" && looksLikeSafetyOr422(e)) {
      console.warn(
        "[animateImage] Seedance refused with safety/422 — retrying with Kling.",
        e instanceof Error ? e.message : String(e),
      );
      const url = await callAnimationModel("kling", imageUrl, prompt);
      return { url };
    }
    throw e;
  }
}
