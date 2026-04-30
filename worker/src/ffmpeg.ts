// ffmpeg compose: scale + crop each clip to 1080x1920, trim each to its
// share of the audio duration, concat into a single visual track, mux the
// narration MP3, optionally mix a low-volume background music track,
// burn-in ASS subtitles, and append a 2-4s logo outro card.
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
  musicPath?: string | null;      // optional MP3 to mix at low volume
  musicVolume?: number;           // 0..1 linear volume for music, defaults to 0.06 (~-25 dB)
}

const DEFAULT_OUTRO_S = 3;
const DEFAULT_OUTRO_BG = "#0B2545"; // brand primary
const DEFAULT_MUSIC_VOLUME = 0.06;
const ASSETS_DIR = process.env.ASSETS_DIR ?? "/app/assets";

// Outro transition timing.
const FADE_TO_WHITE_S = 0.6;        // last X s of main fades to white
const OUTRO_BLUR_FADE_S = 0.8;      // outro logo de-blurs over X s
const OUTRO_FADE_IN_S = 0.6;        // outro emerges from white over X s
const OUTRO_BLUR_RADIUS = 40;       // px boxblur on the blurry copy
const MUSIC_FADE_OUT_S = 0.8;       // music tail fade so audio doesn't cut

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

function escapeForFilter(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function hexToFfColor(hex: string): string {
  return "0x" + hex.replace("#", "").toUpperCase();
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
  musicInputIndex: number | null;
  musicVolume: number;
  totalDurationS: number;
}): string {
  const {
    clipCount, perClipS, audioInputIndex, audioDurationS, assRelPath, fontsDir,
    outroDurationS, outroBgColor, outroImageInputIndex, silenceInputIndex,
    musicInputIndex, musicVolume, totalDurationS,
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
  // last frame). Belt-and-suspenders for the rare case clip totals fall short.
  chains.push(`[vcat_raw]tpad=stop_mode=clone:stop_duration=${audioDurationS.toFixed(3)}[vcat_padded]`);

  // Trim padded visual to exactly audio length, burn subtitles, then fade
  // the very end to white so the outro card emerges from a clean canvas.
  chains.push(`[vcat_padded]trim=duration=${audioDurationS.toFixed(3)},setpts=PTS-STARTPTS[vmain_pre]`);
  chains.push(`[vmain_pre]subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}'[vmain_subbed]`);
  const fadeOutStart = Math.max(0, audioDurationS - FADE_TO_WHITE_S);
  chains.push(
    `[vmain_subbed]fade=type=out:start_time=${fadeOutStart.toFixed(3)}:duration=${FADE_TO_WHITE_S}:color=white[vmain]`,
  );

  // Outro visual. With a logo image, build a "blur fading to sharp"
  // entrance via split + xfade between a blurred and a clean copy of the
  // same composition. Then add a fade-in from white on top so the logo
  // emerges out of the white left behind by vmain's fade-out.
  if (outroImageInputIndex !== null) {
    chains.push(
      `[${outroImageInputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=${ffBg},setsar=1,fps=30,` +
        `trim=duration=${outroDurationS},setpts=PTS-STARTPTS,format=yuv420p[voutro_base]`,
    );
    chains.push(`[voutro_base]split=2[voutro_a][voutro_b]`);
    chains.push(`[voutro_a]boxblur=luma_radius=${OUTRO_BLUR_RADIUS}:luma_power=1[voutro_blur]`);
    // xfade from blurry → sharp over OUTRO_BLUR_FADE_S, starting at t=0.
    chains.push(
      `[voutro_blur][voutro_b]xfade=transition=fade:duration=${OUTRO_BLUR_FADE_S}:offset=0[voutro_xf]`,
    );
    chains.push(
      `[voutro_xf]fade=type=in:duration=${OUTRO_FADE_IN_S}:color=white[voutro]`,
    );
  } else {
    chains.push(
      `color=c=${ffBg}:s=1080x1920:d=${outroDurationS}:r=30,format=yuv420p,fps=30,` +
        `fade=type=in:duration=${OUTRO_FADE_IN_S}:color=white[voutro]`,
    );
  }

  // Concat main + outro. Equal lengths preserved (audioDur + outroDur).
  chains.push(`[vmain][voutro]concat=n=2:v=1:a=0[v_final]`);

  // Audio: trim narration to real length, then concat with silence (covers outro).
  chains.push(
    `[${audioInputIndex}:a]atrim=duration=${audioDurationS.toFixed(3)},asetpts=PTS-STARTPTS,aformat=sample_rates=44100:channel_layouts=stereo[a_main]`,
  );
  chains.push(
    `[${silenceInputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[a_silence]`,
  );
  chains.push(`[a_main][a_silence]concat=n=2:v=0:a=1[a_voice]`);

  // Optional background music: trim to total duration, drop volume, fade
  // the tail so audio doesn't cut at the end of the video, then mix with
  // the voice track. amix uses duration=first so the output ends when the
  // voice (= total) ends; normalize=0 so we keep the relative volumes set.
  if (musicInputIndex !== null) {
    const musicFadeStart = Math.max(0, totalDurationS - MUSIC_FADE_OUT_S);
    chains.push(
      `[${musicInputIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
        `volume=${musicVolume.toFixed(3)},` +
        `atrim=duration=${totalDurationS.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=type=out:start_time=${musicFadeStart.toFixed(3)}:duration=${MUSIC_FADE_OUT_S}[a_music]`,
    );
    chains.push(`[a_voice][a_music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a_final]`);
  } else {
    chains.push(`[a_voice]anull[a_final]`);
  }

  return chains.join(";");
}

export async function compose(args: ComposeArgs): Promise<void> {
  if (args.clipPaths.length === 0) {
    throw new Error("compose: no clips provided");
  }

  const outroDurationS = args.outroDurationS ?? DEFAULT_OUTRO_S;
  const outroBgColor = args.outroBgColor ?? DEFAULT_OUTRO_BG;
  const musicVolume = args.musicVolume ?? DEFAULT_MUSIC_VOLUME;
  const totalDurationS = args.audioDurationS + outroDurationS;

  // Default outro image lookup: caller-supplied path → bundled assets dir.
  let outroImagePath: string | null = args.outroImagePath ?? null;
  if (!outroImagePath) {
    const candidate = join(ASSETS_DIR, "outro.png");
    if (await fileExists(candidate)) outroImagePath = candidate;
  } else if (!(await fileExists(outroImagePath))) {
    outroImagePath = null;
  }

  // Music path is opt-in via caller. If provided but missing on disk, drop it.
  let musicPath: string | null = args.musicPath ?? null;
  if (musicPath && !(await fileExists(musicPath))) {
    musicPath = null;
  }

  // Each clip plays its share of the audio length (with a small tail margin
  // so the concat overshoots audio rather than undershooting it). tpad is
  // the real safety net.
  const perClipS = Math.max(1, args.audioDurationS / args.clipPaths.length + 0.1);

  const cwd = dirname(args.assPath);
  const assRel = basename(args.assPath);

  // Build inputs in this order: clips, audio, [outro image], silence, [music].
  const inputs: string[] = [];
  for (const clip of args.clipPaths) inputs.push("-i", clip);
  inputs.push("-i", args.audioPath);
  const audioInputIndex = args.clipPaths.length;

  let outroImageInputIndex: number | null = null;
  if (outroImagePath) {
    outroImageInputIndex = audioInputIndex + 1;
    inputs.push("-loop", "1", "-t", outroDurationS.toFixed(3), "-i", outroImagePath);
  }

  const silenceInputIndex = (outroImageInputIndex !== null ? outroImageInputIndex : audioInputIndex) + 1;
  inputs.push(
    "-f", "lavfi",
    "-t", outroDurationS.toFixed(3),
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  );

  let musicInputIndex: number | null = null;
  if (musicPath) {
    musicInputIndex = silenceInputIndex + 1;
    inputs.push("-stream_loop", "-1", "-i", musicPath);
  }

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
    musicInputIndex,
    musicVolume,
    totalDurationS,
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
