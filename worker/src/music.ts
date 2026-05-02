// Background-music + sound-effect helpers. Music is served from R2 under
// the music/ prefix (web-uploadable via the app); the bundled
// /app/assets/music directory is the legacy fallback used only when R2
// has no tracks yet (so the existing deploys keep working with their
// baked-in mp3s until users upload replacements).
//
// Sound effects (woosh) remain bundled because they're load-bearing for
// the influencer pipeline and shouldn't be runtime-mutable.

import { createWriteStream } from "node:fs";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const ASSETS_DIR = process.env.ASSETS_DIR ?? "/app/assets";
const MUSIC_DIR = process.env.MUSIC_DIR ?? join(ASSETS_DIR, "music");
const SFX_DIR = process.env.SFX_DIR ?? join(ASSETS_DIR, "Sound effects");
const MUSIC_PREFIX = "music/";

let _s3: S3Client | null = null;
function s3(): S3Client | null {
  if (_s3) return _s3;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY;
  const secretAccessKey = process.env.R2_SECRET;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  _s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _s3;
}

// List all music/*.mp3 keys on R2, sorted alphabetically. Returns an
// empty array when R2 isn't configured or the prefix has nothing yet —
// callers fall back to the bundled music directory.
async function listR2MusicKeys(): Promise<string[]> {
  const client = s3();
  const bucket = process.env.R2_BUCKET;
  if (!client || !bucket) return [];
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: MUSIC_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.toLowerCase().endsWith(".mp3")) {
        keys.push(obj.Key);
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  keys.sort();
  return keys;
}

function r2PublicUrl(key: string): string | null {
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) return null;
  return `${publicUrl.replace(/\/$/, "")}/${key}`;
}

async function downloadToTemp(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download music ${url} (${res.status})`);
  }
  const dir = await mkdtemp(join(tmpdir(), "music-"));
  const dest = join(dir, "track.mp3");
  const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(stream, createWriteStream(dest));
  return dest;
}

export async function pickMusicTrack(shuffleIndex?: number): Promise<string | null> {
  // R2 first. When shuffleIndex is provided, pick deterministically from
  // the alphabetically-sorted key list (matches the bundled-music
  // behavior so the same seed picks the same track regardless of source).
  const r2Keys = await listR2MusicKeys();
  if (r2Keys.length > 0) {
    let key: string;
    if (typeof shuffleIndex === "number" && Number.isFinite(shuffleIndex)) {
      const idx = ((Math.trunc(shuffleIndex) % r2Keys.length) + r2Keys.length) % r2Keys.length;
      key = r2Keys[idx]!;
    } else {
      key = r2Keys[Math.floor(Math.random() * r2Keys.length)]!;
    }
    const url = r2PublicUrl(key);
    if (url) {
      try {
        return await downloadToTemp(url);
      } catch (err) {
        console.error("[music] R2 download failed, falling back to bundled", err);
        // fall through to the bundled-music path
      }
    }
  }

  // Legacy fallback: read from the Docker-bundled directory.
  let entries: string[];
  try {
    entries = await readdir(MUSIC_DIR);
  } catch {
    return null;
  }
  const mp3s = entries.filter((e) => e.toLowerCase().endsWith(".mp3")).sort();
  if (mp3s.length === 0) return null;
  if (typeof shuffleIndex === "number" && Number.isFinite(shuffleIndex)) {
    const idx = ((Math.trunc(shuffleIndex) % mp3s.length) + mp3s.length) % mp3s.length;
    return join(MUSIC_DIR, mp3s[idx]!);
  }
  const choice = mp3s[Math.floor(Math.random() * mp3s.length)]!;
  return join(MUSIC_DIR, choice);
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
