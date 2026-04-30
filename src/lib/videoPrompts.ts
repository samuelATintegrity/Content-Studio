// Fixed image prompts for the video pipeline. Each batch generates these
// five 9:16 visuals via Nano Banana 2; once approved + animated by Seedance,
// they become the shared b-roll for all 3 narrations in the batch.

export const VIDEO_IMAGE_PROMPTS: readonly string[] = [
  "a photo of a new white kitchen",
  "a photo of a new white master bedroom",
  "a photo of a new white bathroom",
  "a photo of a new white home exterior",
  // Slot 4 used to be "a real estate agent speaking with a young couple" but
  // Seedance's safety filter rejects most face-forward couple shots ("422
  // Unprocessable Entity"). Keys + paperwork conveys the same "your agent
  // helping you close" beat without humans in frame.
  "a photo of two house keys with a small brass house keychain resting on a stack of crisp real estate documents on a clean white kitchen counter, soft natural daylight, no people",
] as const;

export const VIDEO_IMAGE_PROMPT_LABELS: readonly string[] = [
  "Kitchen",
  "Bedroom",
  "Bathroom",
  "Exterior",
  "Keys",
] as const;

export const VIDEO_PROMPT_COUNT = VIDEO_IMAGE_PROMPTS.length;

// Style suffix appended to every image prompt so Nano Banana 2 returns
// photorealistic real-estate-grade frames suitable for animation. We avoid
// asking for text/watermarks since the captions are burned in later.
export const VIDEO_IMAGE_STYLE_SUFFIX =
  ". Vertical 9:16 portrait orientation, taller than wide. Photorealistic, professional real estate photography, natural daylight, sharp focus, soft contrast. No text, signs, watermarks, or graphic overlays.";

// Animation prompt sent to Seedance with each approved image.
export const VIDEO_ANIMATION_PROMPT =
  "subtle camera movement, slow steady push-in, no people speaking, no abrupt motion";
