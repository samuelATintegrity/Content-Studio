// ffmpeg compose: scale + crop each clip to 1080x1920, trim each to its
// share of the audio duration, concat into a single visual track, mux the
// narration MP3, and burn-in ASS subtitles. Runs as a single process with
// a complex filtergraph for one-pass efficiency.

import { spawn } from "node:child_process";
import { basename, dirname } from "node:path";

export interface ComposeArgs {
  clipPaths: string[];
  audioPath: string;
  assPath: string;     // path to .ass file (must live in `cwd` for the subtitles filter)
  fontsDir: string;    // directory containing Inter-Bold.ttf etc.
  outPath: string;
  audioDurationS: number;
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      // Keep the buffer bounded — only the tail matters for diagnostics.
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

// Build the per-clip filter chain. Each input is scaled+cropped to 1080x1920,
// trimmed to the per-clip share of the audio duration, has its PTS reset, and
// is labeled [v0], [v1], … for the concat filter.
function buildFilterComplex(clipCount: number, perClipS: number, assRelPath: string, fontsDir: string): string {
  const trim = perClipS.toFixed(3);
  const escapedAss = escapeForFilter(assRelPath);
  const escapedFonts = escapeForFilter(fontsDir);

  const chains: string[] = [];
  for (let i = 0; i < clipCount; i++) {
    chains.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1,fps=30,trim=duration=${trim},setpts=PTS-STARTPTS[v${i}]`,
    );
  }
  const concatInputs = Array.from({ length: clipCount }, (_, i) => `[v${i}]`).join("");
  chains.push(`${concatInputs}concat=n=${clipCount}:v=1:a=0[vcat]`);
  chains.push(`[vcat]subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}'[vout]`);
  return chains.join(";");
}

// ffmpeg's filter argument parser treats `:` and `\` and `'` specially. For
// values inside single-quoted strings, escape `\` and `'`. We avoid colons by
// always passing single-quoted, simple paths.
function escapeForFilter(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function compose(args: ComposeArgs): Promise<void> {
  if (args.clipPaths.length === 0) {
    throw new Error("compose: no clips provided");
  }
  // Each clip plays its share of the audio length (with a small tail margin
  // so the last frame doesn't freeze before audio ends).
  const perClipS = Math.max(1, args.audioDurationS / args.clipPaths.length + 0.05);

  // Run ffmpeg with the workdir as cwd so the subtitles filter can use a
  // relative path — that sidesteps Windows/Linux path-escaping edge cases.
  const cwd = dirname(args.assPath);
  const assRel = basename(args.assPath);

  const inputs: string[] = [];
  for (const clip of args.clipPaths) {
    inputs.push("-i", clip);
  }
  inputs.push("-i", args.audioPath);
  const audioInputIndex = args.clipPaths.length;

  const filter = buildFilterComplex(args.clipPaths.length, perClipS, assRel, args.fontsDir);

  const ffArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-map",
    `${audioInputIndex}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-r",
    "30",
    "-shortest",
    "-movflags",
    "+faststart",
    args.outPath,
  ];

  await runFfmpeg(ffArgs, cwd);
}
