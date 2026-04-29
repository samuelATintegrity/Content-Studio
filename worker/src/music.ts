// Background-music helper. Looks up MP3s bundled at /app/assets/music in the
// Docker runtime and returns one path at random. Returns null if no tracks
// are present, in which case the pipeline renders without music.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

const MUSIC_DIR = process.env.MUSIC_DIR ?? "/app/assets/music";

export async function pickMusicTrack(): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(MUSIC_DIR);
  } catch {
    return null;
  }
  const mp3s = entries.filter((e) => e.toLowerCase().endsWith(".mp3"));
  if (mp3s.length === 0) return null;
  const choice = mp3s[Math.floor(Math.random() * mp3s.length)]!;
  return join(MUSIC_DIR, choice);
}
