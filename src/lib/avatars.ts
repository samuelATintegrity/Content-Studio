import type { Language } from "./types";

// Influencer-mode avatars. Up to 10 entries. Each avatar has a fixed
// ElevenLabs voiceId used for the AI-generated middle TTS, plus a list of
// languages they have intro/outro recordings in. The picker in the sidebar
// hides avatars whose supportedLanguages doesn't include the active one.
//
// Voice IDs are hand-pasted from the ElevenLabs dashboard. There is no UI
// for adding avatars — edit this file directly.

export interface Avatar {
  name: string;
  voiceId: string;
  supportedLanguages: Language[];
  // Optional headshot for the picker UI. Path is relative to /public.
  // e.g. "/avatars/sarah.jpg" → public/avatars/sarah.jpg
  imageUrl?: string;
}

export const AVATARS: Avatar[] = [
  {
    name: "Sarah",
    voiceId: "tnSpp4vdxKPjI9w0GnoV",
    supportedLanguages: ["en"],
    imageUrl: "/avatars/sarah.jpg",
  },
  {
    name: "Valentina",
    voiceId: "j7e3J6ksqsziQcIGyAWI",
    supportedLanguages: ["es"],
    imageUrl: "/avatars/valentina.jpg",
  },
  {
    name: "Amy",
    // Mandarin voice — matches ELEVENLABS_VOICE_ID_ZH used by narration mode.
    voiceId: "bhJUNIXWQQ94l8eI2VUf",
    supportedLanguages: ["zh"],
    imageUrl: "/avatars/amy.jpg",
  },
  {
    name: "Hope",
    // Hope shares Sarah's voice (ELEVENLABS_VOICE_ID_TL, same as
    // ELEVENLABS_VOICE_ID_EN) for the AI middle TTS — Sarah's voice
    // model covers Tagalog cleanly enough that a separate voice for
    // Hope isn't needed.
    voiceId: "tnSpp4vdxKPjI9w0GnoV",
    supportedLanguages: ["tl"],
    imageUrl: "/avatars/hope.jpg",
  },
];

export function getAvatar(name: string): Avatar | undefined {
  return AVATARS.find((a) => a.name === name);
}

export function avatarsForLanguage(language: Language): Avatar[] {
  return AVATARS.filter((a) => a.supportedLanguages.includes(language));
}
