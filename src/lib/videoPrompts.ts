// Fixed image prompts for the video pipeline. Each batch generates these
// five 9:16 visuals via Nano Banana 2; once approved + animated by Seedance,
// they become the shared b-roll for all 3 narrations in the batch.

export const VIDEO_IMAGE_PROMPTS: readonly string[] = [
  "a photo of a new white kitchen",
  // Slot 1 was the master bedroom; swapped to a foyer/entryway because
  // bedrooms read intimate/personal and don't sit right alongside the
  // "buy your own place" pitch tone (per user direction 2026-05-08).
  "a photo of a welcoming front entryway in a new home, bright natural light through the open door, warm wood floors, no people",
  "a photo of a new white bathroom",
  "a photo of a new white home exterior",
  // Slot 4 contains people. Seedance 2.0 safety-rejects most face-forward
  // couple shots, so the orchestrator routes only this slot through Kling
  // v3 Pro (which has no documented face restriction).
  "a photo of a real estate agent speaking with a young couple in a bright modern home, professional and warm",
] as const;

export const VIDEO_IMAGE_PROMPT_LABELS: readonly string[] = [
  "Kitchen",
  "Entryway",
  "Bathroom",
  "Exterior",
  "Agent",
] as const;

export const VIDEO_PROMPT_COUNT = VIDEO_IMAGE_PROMPTS.length;

// Library-pick render: user picks 8 clips up-front. The worker decides
// at render time whether to actually use 7 or 8 based on narration
// length — see PICKED_CLIP_DROP_THRESHOLD_S below. Picking 8 means a
// long narration always has visual coverage, while a short narration
// avoids cutting too rapidly between clips.
export const PICKED_CLIP_COUNT = 8;

// Worker drops the last picked clip when the narration is shorter than
// this many seconds. 30–40s narrations get 7 clips (slower cuts);
// 40s+ narrations keep all 8 (more visual coverage so the audio doesn't
// outrun the clips).
export const PICKED_CLIP_DROP_THRESHOLD_S = 40;

// Style suffix appended to every image prompt so Nano Banana 2 returns
// photorealistic real-estate-grade frames suitable for animation. We avoid
// asking for text/watermarks since the captions are burned in later.
export const VIDEO_IMAGE_STYLE_SUFFIX =
  ". Vertical 9:16 portrait orientation, taller than wide. Photorealistic, professional real estate photography, natural daylight, sharp focus, soft contrast. No text, signs, watermarks, or graphic overlays.";

// Animation prompt sent to Seedance with each approved image.
export const VIDEO_ANIMATION_PROMPT =
  "subtle camera movement, slow steady push-in, no people speaking, no abrupt motion";

// Influencer-mode middle filler clip count. Fixed at 8 so the AI middle
// script (15–20s of audio) gets divided into 8 equal-length clips of
// ~2s each. The pipeline trims each source clip down to its share so
// all 8 play for identical durations and the timeline never desyncs.
export const INFLUENCER_MIDDLE_COUNT = 8;
