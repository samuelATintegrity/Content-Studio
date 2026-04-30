// ElevenLabs TTS — synthesizes narration and returns per-word timestamps
// suitable for karaoke-style subtitles.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

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

interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsResponse {
  audio_base64: string;
  alignment: ElevenLabsAlignment;
  normalized_alignment?: ElevenLabsAlignment;
}

// Group character-level timestamps into words. Whitespace marks word boundaries.
// Punctuation stays attached to the adjacent word so it appears on screen
// alongside it (e.g. "today." rather than splitting the period off alone).
function groupIntoWords(alignment: ElevenLabsAlignment): WordTiming[] {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
  const words: WordTiming[] = [];
  let buf = "";
  let bufStart = 0;
  let bufEnd = 0;

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed.length > 0) {
      words.push({ word: trimmed, startS: bufStart, endS: bufEnd });
    }
    buf = "";
  };

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (ch === undefined) continue;
    const start = character_start_times_seconds[i] ?? 0;
    const end = character_end_times_seconds[i] ?? start;

    if (/\s/.test(ch)) {
      flush();
      continue;
    }

    if (buf.length === 0) bufStart = start;
    buf += ch;
    bufEnd = end;
  }
  flush();

  return words;
}

export async function synthesize(text: string, voiceId: string, outDir: string): Promise<TtsResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      output_format: "mp3_44100_128",
      // Multilingual v2 with style=0 drifts into rising/questioning intonation
      // on short imperative sentences (e.g. our closer). Bumping style to 0.4
      // and enabling speaker_boost gives a more confident, declarative cadence.
      // Slightly higher stability damps the random prosody jumps.
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.4,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 500)}`);
  }

  const json = (await res.json()) as ElevenLabsResponse;
  if (!json.audio_base64 || !json.alignment) {
    throw new Error("ElevenLabs response missing audio_base64 or alignment");
  }

  const audio = Buffer.from(json.audio_base64, "base64");
  const mp3Path = join(outDir, "narration.mp3");
  await writeFile(mp3Path, audio);

  const words = groupIntoWords(json.normalized_alignment ?? json.alignment);
  const last = words[words.length - 1];
  const durationS = last ? last.endS : 0;

  return { mp3Path, durationS, words };
}
