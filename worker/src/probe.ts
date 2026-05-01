// Minimal ffprobe wrapper: returns the duration of a media file in seconds.
// Used by the influencer pipeline to size the intro/outro segments to their
// natural recorded length (no head-trim, no audio synthesis).

import { spawn } from "node:child_process";

export function probeDurationS(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ];
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
      const dur = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(dur) || dur <= 0) {
        reject(new Error(`ffprobe returned non-numeric duration for ${filePath}: ${stdout}`));
        return;
      }
      resolve(dur);
    });
  });
}
