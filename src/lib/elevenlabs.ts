// ElevenLabs TTS — Vercel-runtime variant.
//
// Mirrors worker/src/elevenlabs.ts but returns the mp3 bytes + duration
// directly (no disk writes) so it composes with the export-zip route
// that streams everything in-memory into a JSZip blob.
//
// Voice resolution: the caller may pass an explicit voiceId, or omit
// it and let us pick from `ELEVENLABS_VOICE_ID_<LANG>`. The lookup
// matches the worker's voicesIdFor() behavior so the same voice plays
// across mp4 renders (worker side) and Premiere exports (this side).

import type { Language } from "./types";

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

export interface SynthesizeResult {
  bytes: Buffer;
  durationS: number;
}

export function voiceIdFor(language: Language, override?: string): string {
  if (override && override.trim()) return override.trim();
  const key = `ELEVENLABS_VOICE_ID_${language.toUpperCase()}`;
  const id = process.env[key];
  if (!id) {
    throw new Error(
      `${key} is not set — required to synthesize narration in language "${language}".`,
    );
  }
  return id;
}

// Compute the spoken duration from ElevenLabs' alignment data. We use
// the last character's end time — mp3 frame length parsing would be
// more accurate but the alignment-based number is within ~50ms and
// avoids pulling an mp3 parser into the bundle.
function durationFromAlignment(a: ElevenLabsAlignment): number {
  const ends = a.character_end_times_seconds;
  if (!ends || ends.length === 0) return 0;
  return ends[ends.length - 1] ?? 0;
}

export async function synthesizeNarration(args: {
  text: string;
  language: Language;
  voiceId?: string;
}): Promise<SynthesizeResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

  // Same model selection as the worker so the voice characteristics
  // match between the mp4 render and Premiere export.
  const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3";
  const voiceId = voiceIdFor(args.language, args.voiceId);
  const text = args.text.trim();
  if (!text) throw new Error("synthesizeNarration: text is empty");

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
      model_id: modelId,
      output_format: "mp3_44100_128",
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
    throw new Error(
      `ElevenLabs TTS failed (${res.status}) on model "${modelId}": ${detail.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as ElevenLabsResponse;
  if (!json.audio_base64) {
    throw new Error(`ElevenLabs response missing audio_base64 (model: ${modelId})`);
  }
  if (!json.alignment) {
    throw new Error(
      `ElevenLabs model "${modelId}" did not return alignment timestamps. ` +
      `Set ELEVENLABS_MODEL_ID=eleven_multilingual_v2 to use a model with timestamps.`,
    );
  }

  const bytes = Buffer.from(json.audio_base64, "base64");
  const durationS = durationFromAlignment(json.normalized_alignment ?? json.alignment);
  return { bytes, durationS };
}
