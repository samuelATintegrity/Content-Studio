// ffmpeg invocations — fills in Phase D.
// Stage 1: scale + crop each clip to 1080x1920.
// Stage 2: concat trimmed clips into the visual track.
// Stage 3: mux audio + burn-in ASS subtitles → final MP4.

export interface ComposeArgs {
  clipPaths: string[];
  audioPath: string;
  assPath: string;
  fontsDir: string;
  outPath: string;
  audioDurationS: number;
}

export async function compose(_args: ComposeArgs): Promise<void> {
  throw new Error("ffmpeg.compose: not implemented yet (Phase D)");
}
