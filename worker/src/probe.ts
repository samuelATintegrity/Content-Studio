// Minimal ffprobe wrapper: returns the duration of a media file in seconds.
// Used by the influencer pipeline to size the intro/outro segments to their
// natural recorded length (no head-trim, no audio synthesis).

import { spawn } from "node:child_process";

function runProbe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export async function probeDurationS(filePath: string): Promise<number> {
  const out = await runProbe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const dur = Number.parseFloat(out);
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`ffprobe returned non-numeric duration for ${filePath}: ${out}`);
  }
  return dur;
}

// Probe audio AND video stream durations independently. mp4 files often
// have audio that's slightly longer (or shorter) than video due to
// encoder/edit-list quirks. Trimming both streams to the *shorter* of
// the two keeps the bookend's audio and video locked in sync — and
// keeps the next concat segment from drifting against the previous one.
export async function probeStreamDurationsS(
  filePath: string,
): Promise<{ videoS: number | null; audioS: number | null }> {
  // One ffprobe call per stream type; ffprobe doesn't have a clean way
  // to return per-stream durations in a single CSV row when only some
  // streams are present.
  async function probeOne(streamSpec: string): Promise<number | null> {
    try {
      const out = await runProbe([
        "-v",
        "error",
        "-select_streams",
        streamSpec,
        "-show_entries",
        "stream=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ]);
      const dur = Number.parseFloat(out);
      return Number.isFinite(dur) && dur > 0 ? dur : null;
    } catch {
      return null;
    }
  }
  const [videoS, audioS] = await Promise.all([probeOne("v:0"), probeOne("a:0")]);
  return { videoS, audioS };
}

// Effective bookend duration = min(video, audio) so both streams end at
// the same instant. Falls back to container duration if either stream
// duration is unavailable (rare with well-formed mp4s).
export async function probeBookendDurationS(filePath: string): Promise<number> {
  const { videoS, audioS } = await probeStreamDurationsS(filePath);
  if (videoS !== null && audioS !== null) {
    return Math.min(videoS, audioS);
  }
  if (videoS !== null) return videoS;
  if (audioS !== null) return audioS;
  return probeDurationS(filePath);
}
