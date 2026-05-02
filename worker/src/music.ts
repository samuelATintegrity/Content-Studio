// Background-music + sound-effect helpers. Looks up MP3s bundled into
// /app/assets/{music,Sound effects} in the Docker runtime and returns
// matching paths. Returns null when nothing matches, in which case the
// pipeline renders without that audio layer.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ASSETS_DIR = process.env.ASSETS_DIR ?? "/app/assets";
const MUSIC_DIR = process.env.MUSIC_DIR ?? join(ASSETS_DIR, "music");
const SFX_DIR = process.env.SFX_DIR ?? join(ASSETS_DIR, "Sound effects");

export async function pickMusicTrack(): Promise<string | null> {
  return pickRandomMp3(MUSIC_DIR);
}

// Find a sound effect by name fragment (case-insensitive substring match
// on the filename, e.g. "woosh" matches "WHSH-woosh-Elevenlabs.mp3").
// Returns null if the SFX dir doesn't exist or nothing matches.
export async function pickSoundEffect(nameFragment: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(SFX_DIR);
  } catch {
    return null;
  }
  const needle = nameFragment.toLowerCase();
  const matches = entries.filter((e) => {
    if (!e.toLowerCase().endsWith(".mp3")) return false;
    return e.toLowerCase().includes(needle);
  });
  if (matches.length === 0) return null;
  const choice = matches[Math.floor(Math.random() * matches.length)]!;
  return join(SFX_DIR, choice);
}

async function pickRandomMp3(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const mp3s = entries.filter((e) => e.toLowerCase().endsWith(".mp3"));
  if (mp3s.length === 0) return null;
  const choice = mp3s[Math.floor(Math.random() * mp3s.length)]!;
  return join(dir, choice);
}
