// Shared types between the Vercel app and the Railway worker.
// (Duplicated rather than imported to keep the worker its own deployable.)

export type Language = "en" | "tl" | "es" | "zh";

export type ContentType =
  | "zero_down_generic"
  | "edu_zero_down_usda_local"
  | "edu_dpa_local"
  | "language_match"
  | "good_agents";

export type JobStateName =
  | "queued"
  | "tts"
  | "footage"
  | "rendering"
  | "uploading"
  | "ready"
  | "failed";

export interface JobState {
  id: string;
  state: JobStateName;
  progress: number; // 0..1
  videoUrl?: string;
  durationS?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// Phrase + on-screen label for styled title-card overlays. Worker matches
// `phrase` against TTS word timings to find the on-screen span; `label` is
// what gets rendered (often phrase upper-cased).
export interface TitleMoment {
  phrase: string;
  label: string;
}

// Body of POST /render from Vercel.
export interface RenderRequest {
  script: string;          // narration text
  language: Language;      // selects voice + caption styling
  contentType: ContentType;// kept for logging / future per-type music selection
  clipUrls: string[];      // pre-made 9:16 clips (Seedance-animated images), in order
  titleMoments?: TitleMoment[]; // 0–2 styled title cards Claude flagged in the script
}

export interface RenderResponse {
  jobId: string;
}

export interface StatusResponse {
  state: JobStateName;
  progress: number;
  videoUrl?: string;
  durationS?: number;
  error?: string;
}
