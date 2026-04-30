// Fixed image prompts for the video pipeline. Each batch generates these
// five 9:16 visuals via Nano Banana 2; once approved + animated by Seedance,
// they become the shared b-roll for all 3 narrations in the batch.

export const VIDEO_IMAGE_PROMPTS: readonly string[] = [
  "a photo of a new white kitchen",
  "a photo of a new white master bedroom",
  "a photo of a new white bathroom",
  "a photo of a new white home exterior",
  // Slot 4 contains people. Seedance 2.0 safety-rejects most face-forward
  // couple shots, so the orchestrator routes only this slot through Kling
  // v3 Pro (which has no documented face restriction).
  "a photo of a real estate agent speaking with a young couple in a bright modern home, professional and warm",
] as const;

export const VIDEO_IMAGE_PROMPT_LABELS: readonly string[] = [
  "Kitchen",
  "Bedroom",
  "Bathroom",
  "Exterior",
  "Agent",
] as const;

export const VIDEO_PROMPT_COUNT = VIDEO_IMAGE_PROMPTS.length;

// Library-pick render uses more clips than from-scratch: when the user is
// stitching from their existing library, longer narrations are more likely,
// and 7 clips give ~10 extra seconds of visual time before the white-hold
// outro kicks in. From-scratch stays at 5 to keep generation cost manageable.
export const PICKED_CLIP_COUNT = 7;

// Style suffix appended to every image prompt so Nano Banana 2 returns
// photorealistic real-estate-grade frames suitable for animation. We avoid
// asking for text/watermarks since the captions are burned in later.
export const VIDEO_IMAGE_STYLE_SUFFIX =
  ". Vertical 9:16 portrait orientation, taller than wide. Photorealistic, professional real estate photography, natural daylight, sharp focus, soft contrast. No text, signs, watermarks, or graphic overlays.";

// Animation prompt sent to Seedance with each approved image.
export const VIDEO_ANIMATION_PROMPT =
  "subtle camera movement, slow steady push-in, no people speaking, no abrupt motion";
