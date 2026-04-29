// ffmpeg compose: scale + crop each clip to 1080x1920, trim each to its
// share of the audio duration, concat into a single visual track, mux the
// narration MP3, burn-in ASS subtitles, and append a 2-4s logo outro card.
// Runs as a single process with a complex filtergraph.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface ComposeArgs {
  clipPaths: string[];
  audioPath: string;
  assPath: string;     // path to .ass file (must live in `cwd` for the subtitles filter)
  fontsDir: string;    // directory containing Inter-Bold.ttf etc.
  outPath: string;
  audioDurationS: number;
  outroImagePath?: string | null; // optional logo image for outro card
  outroDurationS?: number;        // outro length, defaults to 3s
  outroBgColor?: string;          // hex (#RRGGBB) for outro background, defaults to brand primary
}

const DEFAULT_OUTRO_S = 3;
const DEFAULT_OUTRO_BG = "#0B2545"; // brand primary
const ASSETS_DIR = process.env.ASSETS_DIR ?? "/app/assets";

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ffmpeg's filter argument parser treats `:` and `\` and `'` specially. For
// values inside single-quoted strings, escape `\` and `'`. We avoid colons by
// always passing single-quoted, simple paths.
function escapeForFilter(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

// Convert "#RRGGBB" → ffmpeg-compatible "0xRRGGBB".
function hexToFfColor(hex: string): string {
  return "0x" + hex.replace("#", "").toUpperCase();
}

interface FilterPlan {
  filter: string;
  videoOutLabel: string;
  audioOutLabel: string;
  outroInputIndex: number | null;  // index of -loop 1 -i outro.png if used
  silenceInputIndex: number;        // index of -f lavfi anullsrc input
}

function buildFilterComplex(args: {
  clipCount: number;
  perClipS: number;
  audioInputIndex: number;
  audioDurationS: number;
  assRelPath: string;
  fontsDir: string;
  outroDurationS: number;
  outroBgColor: string;
  outroImageInputIndex: number | null;
  silenceInputIndex: number;
}): string {
  const {
    clipCount, perClipS, audioInputIndex, audioDurationS, assRelPath, fontsDir,
    outroDurationS, outroBgColor, outroImageInputIndex, silenceInputIndex,
  } = args;

  const trim = perClipS.toFixed(3);
  const escapedAss = escapeForFilter(assRelPath);
  const escapedFonts = escapeForFilter(fontsDir);
  const ffBg = hexToFfColor(outroBgColor);

  const chains: string[] = [];

  // Per-clip scale + crop + trim. Output [v0]..[vN-1].
  for (let i = 0; i < clipCount; i++) {
    chains.push(
      `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1,fps=30,trim=duration=${trim},setpts=PTS-STARTPTS[v${i}]`,
    );
  }

  // Concat the per-clip streams.
  const concatInputs = Array.from({ length: clipCount }, (_, i) => `[v${i}]`).join("");
  chains.push(`${concatInputs}concat=n=${clipCount}:v=1:a=0[vcat_raw]`);

  // Pad the visual track so it's at least as long as the audio (clones the
  // last frame). Without this, if clip totals fall short of audio, the
  // -shortest flag would cut the audio. Belt-and-suspenders alongside the
  // min-duration filter in pexelsVideo.
  chains.push(`[vcat_raw]tpad=stop_mode=clone:stop_duration=${audioDurationS.toFixed(3)}[vcat_padded]`);

  // Trim padded visual to exactly audio length, then burn subtitles.
  chains.push(`[vcat_padded]trim=duration=${audioDurationS.toFixed(3)},setpts=PTS-STARTPTS[vmain_pre]`);
  chains.push(`[vmain_pre]subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}'[vmain]`);

  // Outro visual. If a logo image is provided, scale-pad it onto a 1080x1920
  // canvas with the brand background colour. Otherwise generate a solid card.
  if (outroImageInputIndex !== null) {
    chains.push(
      `[${outroImageInputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=${ffBg},setsar=1,fps=30,` +
        `trim=duration=${outroDurationS},setpts=PTS-STARTPTS,format=yuv420p[voutro]`,
    );
  } else {
    chains.push(
      `color=c=${ffBg}:s=1080x1920:d=${outroDurationS}:r=30,format=yuv420p,fps=30[voutro]`,
    );
  }

  // Concat main + outro into final video stream.
  chains.push(`[vmain][voutro]concat=n=2:v=1:a=0[v_final]`);

  // Audio: trim narration to its real length, then concat with silence.
  chains.push(
    `[${audioInputIndex}:a]atrim=duration=${audioDurationS.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a_main]`,
  );
  chains.push(
    `[${silenceInputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[a_silence]`,
  );
  chains.push(`[a_main][a_silence]concat=n=2:v=0:a=1[a_final]`);

  return chains.join(";");
}

export async function compose(args: ComposeArgs): Promise<void> {
  if (args.clipPaths.length === 0) {
    throw new Error("compose: no clips provided");
  }

  const outroDurationS = args.outroDurationS ?? DEFAULT_OUTRO_S;
  const outroBgColor = args.outroBgColor ?? DEFAULT_OUTRO_BG;

  // Default outro image lookup: caller-supplied path → bundled assets dir.
  let outroImagePath: string | null = args.outroImagePath ?? null;
  if (!outroImagePath) {
    const candidate = join(ASSETS_DIR, "outro.png");
    if (await fileExists(candidate)) outroImagePath = candidate;
  } else if (!(await fileExists(outroImagePath))) {
    outroImagePath = null;
  }

  // Each clip plays its share of the audio length (with a small tail margin
  // so the concat overshoots audio rather than undershooting it). The tpad
  // stage above is the real safety net.
  const perClipS = Math.max(1, args.audioDurationS / args.clipPaths.length + 0.1);

  const cwd = dirname(args.assPath);
  const assRel = basename(args.assPath);

  // Build inputs in this order: clips, audio, [outro image], silence.
  const inputs: string[] = [];
  for (const clip of args.clipPaths) inputs.push("-i", clip);
  inputs.push("-i", args.audioPath);
  const audioInputIndex = args.clipPaths.length;

  let outroImageInputIndex: number | null = null;
  if (outroImagePath) {
    outroImageInputIndex = audioInputIndex + 1;
    inputs.push("-loop", "1", "-t", outroDurationS.toFixed(3), "-i", outroImagePath);
  }

  // Silence track for outro audio (always last input).
  const silenceInputIndex = (outroImageInputIndex !== null ? outroImageInputIndex : audioInputIndex) + 1;
  inputs.push(
    "-f", "lavfi",
    "-t", outroDurationS.toFixed(3),
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  );

  const filter = buildFilterComplex({
    clipCount: args.clipPaths.length,
    perClipS,
    audioInputIndex,
    audioDurationS: args.audioDurationS,
    assRelPath: assRel,
    fontsDir: args.fontsDir,
    outroDurationS,
    outroBgColor,
    outroImageInputIndex,
    silenceInputIndex,
  });

  const ffArgs = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    ...inputs,
    "-filter_complex", filter,
    "-map", "[v_final]",
    "-map", "[a_final]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-r", "30",
    "-movflags", "+faststart",
    args.outPath,
  ];

  await runFfmpeg(ffArgs, cwd);
}
