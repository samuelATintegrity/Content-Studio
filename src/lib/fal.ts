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

type FalVideoFile = { url?: string };
type FalVideoData = { video?: FalVideoFile };

function extractVideoUrl(result: unknown): string {
  const data = (result as { data?: FalVideoData }).data;
  const url = data?.video?.url;
  if (!url) throw new Error("fal.ai returned no video URL");
  return url;
}

// Animate a still image with subtle camera movement. 5s duration is fixed
// by product decision. Routes to Seedance by default (sharper for places /
// architecture and supports 1080p) or Kling when the source image contains
// human faces (Seedance's safety filter rejects most face-forward people
// shots with 422; Kling has no documented face restriction).
export async function animateImage(
  imageUrl: string,
  model: AnimationModel = "seedance",
): Promise<{ url: string }> {
  configure();
  if (!imageUrl) throw new Error("animateImage: imageUrl required");

  if (model === "kling") {
    const klingInput = {
      start_image_url: imageUrl,
      prompt: VIDEO_ANIMATION_PROMPT,
      duration: "5",
      generate_audio: false,
    };
    const result = await fal.subscribe(KLING_MODEL, {
      input: klingInput as never,
      logs: false,
    });
    return { url: extractVideoUrl(result) };
  }

  // Seedance 2.0 (default)
  const seedanceInput = {
    image_url: imageUrl,
    prompt: VIDEO_ANIMATION_PROMPT,
    aspect_ratio: "9:16",
    duration: 5,            // seedance 2.0 takes a number 4-15
    resolution: "1080p",
    generate_audio: false,  // we mux our own narration; skip TTS to save cost
  };
  const result = await fal.subscribe(SEEDANCE_MODEL, {
    // The SDK's typings don't yet cover the seedance-2.0 input shape.
    input: seedanceInput as never,
    logs: false,
  });
  return { url: extractVideoUrl(result) };
}
