// ElevenLabs Speech-to-Text wrapper for the influencer pipeline. Used to
// generate per-word timestamps over the pre-recorded intro/outro audio so
// karaoke captions can be burned over those segments alongside the AI
// middle TTS.
//
// API: https://elevenlabs.io/docs/api-reference/speech-to-text — model
// "scribe_v1" returns { text, words: [{ text, start, end, type }, …] }.

import { readFile } from "node:fs/promises";
import type { WordTiming } from "./elevenlabs.js";

interface ElevenLabsSttWord {
  text: string;
  start: number;
  end: number;
  type?: string; // "word" | "spacing" | "audio_event" — we keep only "word"
}

interface ElevenLabsSttResponse {
  text?: string;
  words?: ElevenLabsSttWord[];
  language_code?: string;
}

// Returns word-level timings for the given media file. Throws on API
// failure so the caller can decide whether to fall back to no-captions.
export async function transcribeMediaFile(
  filePath: string,
): Promise<WordTiming[]> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

  const buffer = await readFile(filePath);
  // Node 22's File comes from undici; the Web standard FormData accepts it.
  const file = new File([buffer], filePath.split(/[\\/]/).pop() ?? "audio.mp4", {
    type: "video/mp4",
  });

  const form = new FormData();
  form.append("file", file);
  form.append("model_id", "scribe_v1");
  // Auto-detect language; the recordings should match the avatar's
  // recorded language.
  form.append("timestamps_granularity", "word");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs STT failed (${res.status}): ${detail.slice(0, 500)}`);
  }

  const json = (await res.json()) as ElevenLabsSttResponse;
  if (!Array.isArray(json.words)) {
    throw new Error("ElevenLabs STT response missing 'words' array");
  }

  // Strip non-"word" entries (spacing, audio_event) and map to the shared
  // WordTiming shape used by the karaoke subtitle builder.
  return json.words
    .filter((w) => (w.type ?? "word") === "word" && w.text.trim().length > 0)
    .map((w) => ({
      word: w.text,
      startS: w.start,
      endS: w.end,
    }));
}

// Drop all words from the first occurrence of `cutoffPhrase` (case-
// insensitive, multi-word) onwards. If the phrase doesn't appear, all
// words are returned unchanged.
export function applyCaptionCutoff(
  words: WordTiming[],
  cutoffPhrase: string | undefined,
): WordTiming[] {
  if (!cutoffPhrase) return words;
  const target = cutoffPhrase
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (target.length === 0) return words;

  const norm = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9']+/g, "");

  for (let i = 0; i + target.length <= words.length; i++) {
    let matches = true;
    for (let j = 0; j < target.length; j++) {
      if (norm(words[i + j]!.word) !== norm(target[j]!)) {
        matches = false;
        break;
      }
    }
    if (matches) return words.slice(0, i);
  }
  return words;
}
