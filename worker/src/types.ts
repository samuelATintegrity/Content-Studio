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

export type RenderMode = "narration" | "influencer" | "funny_commercial";

// Body of POST /render from Vercel.
export interface RenderRequest {
  script: string;          // narration text
  language: Language;      // selects voice + caption styling
  contentType: ContentType;// kept for logging / future per-type music selection
  clipUrls: string[];      // pre-made 9:16 clips (Seedance-animated images), in order
  // Influencer mode: a single pre-recorded intro clip + N filler middle
  // clips (clipUrls) + a pre-recorded outro clip. Intro/outro carry their
  // own audio; the middle gets TTS narration + karaoke captions; the
  // intro/outro audio is transcribed via ElevenLabs STT to drive their
  // own karaoke captions. captionCutoffPhrase, when set on a bookend,
  // drops captions from that phrase onward (e.g. to clear the canvas
  // before a brand mention so the editor can drop a title card on top).
  mode?: RenderMode;
  voiceId?: string;
  introClipUrl?: string;
  introCaptionCutoffPhrase?: string;
  outroClipUrl?: string;
  outroCaptionCutoffPhrase?: string;
  // Deterministic music selection. The worker picks
  // music[abs(musicShuffleIndex) % music_file_count]. The app sets
  // index = batchSeed + 0/1/2 across the 3 renders in an influencer
  // batch so each render gets a different file from the music dir,
  // and a fresh batchSeed per batch varies which 3 files are picked.
  // Falls back to random when undefined.
  musicShuffleIndex?: number;
  // Funny Commercial mode. clipUrls = [scene1Url, scene2ActorUrl] in
  // scene order; the worker bakes Scene 3 (black + CTA) and Scene 4
  // (logo) on the fly. Both text overlays come pre-formed from the
  // app — Scene 3 is already translated to the target language.
  fcScene2Text?: string;
  fcScene3Text?: string;
  fcScene1DurationS?: number;
  fcScene2DurationS?: number;
  fcScene3DurationS?: number;
  fcScene4DurationS?: number;
  fcMusicTrackUrl?: string | null;
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
