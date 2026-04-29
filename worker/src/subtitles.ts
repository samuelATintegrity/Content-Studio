// Karaoke (word-by-word highlight) ASS subtitle generator — fills in Phase C.

import type { WordTiming } from "./elevenlabs.js";

export interface SubtitleStyle {
  primaryColor: string;   // hex e.g. "#FFFFFF" — base text color
  highlightColor: string; // hex e.g. "#EEF4ED" — current-word color
  fontFamily: string;     // e.g. "Inter"
  fontSize: number;       // px (in a 1080x1920 canvas)
  marginV: number;        // distance from bottom in px
}

export function buildAssSubtitles(_words: WordTiming[], _style: SubtitleStyle): string {
  throw new Error("subtitles.buildAssSubtitles: not implemented yet (Phase C)");
}
