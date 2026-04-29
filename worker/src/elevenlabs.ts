// ElevenLabs TTS wrapper — fills in during Phase C.
// Returns: MP3 file path on disk + per-word timestamps for karaoke subtitles.

export interface WordTiming {
  word: string;
  startS: number;
  endS: number;
}

export interface TtsResult {
  mp3Path: string;
  durationS: number;
  words: WordTiming[];
}

export async function synthesize(_text: string, _voiceId: string, _outDir: string): Promise<TtsResult> {
  throw new Error("elevenlabs.synthesize: not implemented yet (Phase C)");
}
