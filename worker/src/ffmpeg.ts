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
// Hold a blank white card after narration ends, before the logo fades in.
// This gives the last subtitle word room to clear so captions never overlap
// the logo. Only applies when audio outlasts the clip track.
const WHITE_HOLD_BUFFER_S = 0.4;

// Source clip handling.
const SOURCE_CLIP_DURATION_S = 5;   // duration we ask Seedance / Kling for
const CLIP_HEAD_TRIM_S = 0.15;      // skip the warmup wobble in the first frame

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
  clipHeadTrimS: number;
  clipsLengthS: number;
  whiteHoldS: number;
  outroDurationS: number;
  audioInputIndex: number;
  audioDurationS: number;
  assRelPath: string;
  fontsDir: string;
  outroBgColor: string;
  outroImageInputIndex: number | null;
  silenceInputIndex: number;
  musicInputIndex: number | null;
  musicVolume: number;
  totalDurationS: number;
}): string {
  const {
    clipCount, perClipS, clipHeadTrimS, clipsLengthS, whiteHoldS, outroDurationS,
    audioInputIndex, audioDurationS, assRelPath, fontsDir,
    outroBgColor, outroImageInputIndex, silenceInputIndex,
    musicInputIndex, musicVolume, totalDurationS,
  } = args;

  const escapedAss = escapeForFilter(assRelPath);
  const escapedFonts = escapeForFilter(fontsDir);
  const ffBg = hexToFfColor(outroBgColor);

  const chains: string[] = [];

  // Per-clip: skip the first CLIP_HEAD_TRIM_S to drop Seedance/Kling's
  // warmup-frame wobble, then take perClipS seconds from there. Reset PTS
  // so concat can stitch streams without timestamp gaps.
  for (let i = 0; i < clipCount; i++) {
    chains.push(
      `[${i}:v]trim=start=${clipHeadTrimS.toFixed(3)}:duration=${perClipS.toFixed(3)},setpts=PTS-STARTPTS,` +
        `scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1,fps=30[v${i}]`,
    );
  }

  // Concat the per-clip streams. No tpad — if clips are shorter than audio
  // we let the outro card take over instead of freezing the last frame.
  const concatInputs = Array.from({ length: clipCount }, (_, i) => `[v${i}]`).join("");
  chains.push(`${concatInputs}concat=n=${clipCount}:v=1:a=0[vcat]`);

  // Fade the very end of the clip track to white so the logo card emerges
  // from a clean canvas. Subtitles are burned AFTER concat (below) so they
  // can keep showing during the outro if narration extends that long.
  // format=yuv420p forces explicit pixel-format normalization so the later
  // concat with [vwhite] / [voutro] doesn't fail in auto_scale negotiation.
  const fadeOutStart = Math.max(0, clipsLengthS - FADE_TO_WHITE_S);
  chains.push(
    `[vcat]fade=type=out:start_time=${fadeOutStart.toFixed(3)}:duration=${FADE_TO_WHITE_S}:color=white,format=yuv420p,setsar=1[vmain]`,
  );

  // White hold segment: a plain white card that fills the gap between when
  // the clips end (faded to white) and when narration + subtitles wrap up.
  // Subtitles continue burning over this segment, so the last few words of
  // the script clear cleanly on white instead of stamping over the logo.
  // Only emitted when needed (whiteHoldS > 0).
  if (whiteHoldS > 0) {
    chains.push(
      `color=c=white:s=1080x1920:d=${whiteHoldS.toFixed(3)}:r=30,format=yuv420p,setsar=1[vwhite]`,
    );
  }

  // Outro visual: full outroDurationS of logo card, blur-to-sharp, fading in
  // from white. Subtitles do NOT continue across this segment — we burn them
  // before this concat.
  if (outroImageInputIndex !== null) {
    chains.push(
      `[${outroImageInputIndex}:v]scale=1080:1920:force_original_aspect_ratio=decrease,` +
        `pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=${ffBg},setsar=1,fps=30,` +
        `trim=duration=${outroDurationS.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[voutro_base]`,
    );
    chains.push(`[voutro_base]split=2[voutro_a][voutro_b]`);
    chains.push(`[voutro_a]boxblur=luma_radius=${OUTRO_BLUR_RADIUS}:luma_power=1[voutro_blur]`);
    chains.push(
      `[voutro_blur][voutro_b]xfade=transition=fade:duration=${OUTRO_BLUR_FADE_S}:offset=0[voutro_xf]`,
    );
    chains.push(
      `[voutro_xf]fade=type=in:duration=${OUTRO_FADE_IN_S}:color=white[voutro]`,
    );
  } else {
    chains.push(
      `color=c=${ffBg}:s=1080x1920:d=${outroDurationS.toFixed(3)}:r=30,format=yuv420p,fps=30,setsar=1,` +
        `fade=type=in:duration=${OUTRO_FADE_IN_S}:color=white[voutro]`,
    );
  }

  // Burn subtitles over clips + white-hold (subtitles end with the audio,
  // so they naturally stop before the logo). Then concat with the logo.
  const captionedLabel = whiteHoldS > 0 ? "v_captioned" : "vmain";
  if (whiteHoldS > 0) {
    chains.push(`[vmain][vwhite]concat=n=2:v=1:a=0[v_captioned]`);
  }
  chains.push(`[${captionedLabel}]subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}',format=yuv420p,setsar=1[v_subbed]`);
  chains.push(`[v_subbed][voutro]concat=n=2:v=1:a=0[v_final]`);

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

  // Per-clip duration: bounded above by what the source actually has after
  // head-trim, below by the audio share. Both ends prevent over- or under-
  // shooting the natural clip length.
  const maxAvailablePerClip = SOURCE_CLIP_DURATION_S - CLIP_HEAD_TRIM_S;
  const audioShare = args.audioDurationS / args.clipPaths.length;
  const perClipS = Math.max(0.5, Math.min(maxAvailablePerClip, audioShare));
  const clipsLengthS = perClipS * args.clipPaths.length;

  // Hold a blank white card after clips end if narration is still running.
  // This is the buffer where remaining captions clear before the logo fades
  // in, so subtitles never overlap the logo.
  const whiteHoldS = Math.max(
    0,
    args.audioDurationS + WHITE_HOLD_BUFFER_S - clipsLengthS,
  );

  // Total render length: clips + white hold + logo card. Eliminates the
  // freeze-frame artifact that used to appear when audio was longer than
  // the clip total, and gives the logo its own clean window.
  const totalDurationS = clipsLengthS + whiteHoldS + outroDurationS;

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
    // -loop the still image; filter trim bounds it again. Long enough is
    // harmless, but match outroDurationS now that the logo is its own slot.
    inputs.push("-loop", "1", "-t", outroDurationS.toFixed(3), "-i", outroImagePath);
  }

  // Silence covers the white hold + logo segment (everything after audio ends).
  const silenceLengthS = Math.max(0.1, totalDurationS - args.audioDurationS);
  const silenceInputIndex = (outroImageInputIndex !== null ? outroImageInputIndex : audioInputIndex) + 1;
  inputs.push(
    "-f", "lavfi",
    "-t", silenceLengthS.toFixed(3),
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
    clipHeadTrimS: CLIP_HEAD_TRIM_S,
    clipsLengthS,
    whiteHoldS,
    outroDurationS,
    audioInputIndex,
    audioDurationS: args.audioDurationS,
    assRelPath: assRel,
    fontsDir: args.fontsDir,
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
