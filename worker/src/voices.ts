import type { Language } from "./types.js";

// Map a language to its ElevenLabs voice ID. Each language gets its own
// dedicated voice tuned for that language's pronunciation; configurable
// per-language via env vars without redeploying.
export function voiceIdFor(language: Language): string {
  const key = `ELEVENLABS_VOICE_ID_${language.toUpperCase()}`;
  const id = process.env[key];
  if (!id) {
    throw new Error(`Voice ID env var ${key} is not set`);
  }
  return id;
}
