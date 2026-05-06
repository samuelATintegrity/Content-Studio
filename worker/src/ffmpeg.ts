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
const DEFAULT_MUSIC_VOLUME = 0.25; // ~+4 dB louder than the prior 0.15, ~+12 dB over the original 0.06
// Narration is mixed at slightly under unity so the music sits up alongside
// it more comfortably. ~-1.5 dB; small enough that no make-up gain is needed.
const NARRATION_VOLUME = 0.85;
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
        `trim=duration=${outroDurationS.toFixed(6)},setpts=PTS-STARTPTS,format=yuv420p[voutro_base]`,
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
      `color=c=${ffBg}:s=1080x1920:d=${outroDurationS.toFixed(6)}:r=30,format=yuv420p,fps=30,setsar=1,` +
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

  // Audio: trim narration to real length, drop it slightly under unity so the
  // music sits comfortably alongside, then concat with silence (covers outro).
  chains.push(
    `[${audioInputIndex}:a]atrim=duration=${audioDurationS.toFixed(3)},asetpts=PTS-STARTPTS,volume=${NARRATION_VOLUME.toFixed(3)},aformat=sample_rates=44100:channel_layouts=stereo[a_main]`,
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

// ── Funny Commercial v2 compose ────────────────────────────────────
//
// Variable-length timeline of pre-animated 9:16 clips, each trimmed
// to its slot duration, concatenated, with ASS-burned text overlays
// per slot, optional ElevenLabs narrations mixed at slot start times,
// and a logo bumper appended at the end. All clips' native audio
// (Veo generates audio for every clip) plays through; narrations sit
// on top via amix.
//
// This replaces the v1 4-scene fixed compose. The muffled-through-the-
// wall gag from v1 is gone — that was specific to the bedroom shot
// pattern and the new flow gives the user explicit per-slot control.

const FC_NARRATION_VOLUME = 0.95;
const FC_CLIP_AUDIO_VOLUME = 0.55;  // duck under narration when present
const FC_MUSIC_VOLUME = 0.18;

export interface FcNarrationItem {
  mp3Path: string;
  startS: number;
  durationS: number;
}

export interface ComposeFunnyCommercialArgs {
  clipPaths: string[];
  slotDurations: number[];           // parallel to clipPaths
  narrations: FcNarrationItem[];     // may be empty
  outroLogoPath?: string | null;
  logoOutroDurationS: number;
  assPath: string;
  fontsDir: string;
  outPath: string;
  musicPath?: string | null;
}

export async function composeFunnyCommercial(args: ComposeFunnyCommercialArgs): Promise<void> {
  if (args.clipPaths.length === 0) {
    throw new Error("composeFunnyCommercial: no clips provided");
  }
  if (args.clipPaths.length !== args.slotDurations.length) {
    throw new Error("composeFunnyCommercial: clipPaths.length must equal slotDurations.length");
  }

  const cwd = dirname(args.assPath);
  const assRel = basename(args.assPath);
  const escapedAss = escapeForFilter(assRel);
  const escapedFonts = escapeForFilter(args.fontsDir);

  const totalClipsS = args.slotDurations.reduce((a, b) => a + b, 0);
  const totalDurationS = totalClipsS + args.logoOutroDurationS;

  let outroLogoPath: string | null = args.outroLogoPath ?? null;
  if (!outroLogoPath) {
    const candidate = join(ASSETS_DIR, "outro.png");
    if (await fileExists(candidate)) outroLogoPath = candidate;
  } else if (!(await fileExists(outroLogoPath))) {
    outroLogoPath = null;
  }

  let musicPath: string | null = args.musicPath ?? null;
  if (musicPath && !(await fileExists(musicPath))) musicPath = null;

  // ── Inputs ───────────────────────────────────────────────────────
  // Order: clips, [outro logo], narrations, [music].
  const inputs: string[] = [];
  for (const clip of args.clipPaths) inputs.push("-i", clip);
  let nextIdx = args.clipPaths.length;
  let outroLogoIdx: number | null = null;
  if (outroLogoPath) {
    outroLogoIdx = nextIdx;
    inputs.push("-loop", "1", "-t", args.logoOutroDurationS.toFixed(3), "-i", outroLogoPath);
    nextIdx += 1;
  }
  const narrationIndices: number[] = [];
  for (const n of args.narrations) {
    narrationIndices.push(nextIdx);
    inputs.push("-i", n.mp3Path);
    nextIdx += 1;
  }
  let musicIdx: number | null = null;
  if (musicPath) {
    musicIdx = nextIdx;
    inputs.push("-stream_loop", "-1", "-i", musicPath);
    nextIdx += 1;
  }

  const chains: string[] = [];

  // ── Video chain ──────────────────────────────────────────────────
  for (let i = 0; i < args.clipPaths.length; i++) {
    const dur = args.slotDurations[i]!.toFixed(3);
    chains.push(
      `[${i}:v]trim=duration=${dur},setpts=PTS-STARTPTS,` +
        `scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
  }
  // Logo bumper on V1.
  if (outroLogoIdx !== null) {
    chains.push(
      `color=c=black:s=1080x1920:d=${args.logoOutroDurationS.toFixed(3)}:r=30,format=yuv420p,setsar=1[v_outro_bg]`,
    );
    chains.push(
      `[${outroLogoIdx}:v]scale=756:-1:force_original_aspect_ratio=decrease,format=rgba[v_outro_logo]`,
    );
    chains.push(
      `[v_outro_bg][v_outro_logo]overlay=(W-w)/2:(H-h)/2:format=auto[v_outro]`,
    );
  } else {
    chains.push(
      `color=c=black:s=1080x1920:d=${args.logoOutroDurationS.toFixed(3)}:r=30,format=yuv420p,setsar=1[v_outro]`,
    );
  }
  // Concat clips + outro.
  const concatVInputs =
    Array.from({ length: args.clipPaths.length }, (_, i) => `[v${i}]`).join("") + "[v_outro]";
  chains.push(
    `${concatVInputs}concat=n=${args.clipPaths.length + 1}:v=1:a=0[v_cat]`,
  );
  // Burn ASS overlays.
  chains.push(
    `[v_cat]subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}',format=yuv420p,setsar=1[v_final]`,
  );

  // ── Audio chain ──────────────────────────────────────────────────
  // Per-clip native audio, trimmed + padded to slot duration. apad
  // covers clips that were animated without audio (Seedance fallback,
  // edge cases) so the final concat lengths still line up.
  for (let i = 0; i < args.clipPaths.length; i++) {
    const dur = args.slotDurations[i]!.toFixed(3);
    chains.push(
      `[${i}:a]aresample=async=1:first_pts=0,atrim=duration=${dur},asetpts=PTS-STARTPTS,` +
        `volume=${FC_CLIP_AUDIO_VOLUME.toFixed(3)},` +
        `aformat=sample_rates=44100:channel_layouts=stereo,apad=whole_dur=${dur}[a${i}]`,
    );
  }
  // Outro segment: silence.
  chains.push(
    `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${args.logoOutroDurationS.toFixed(3)},asetpts=PTS-STARTPTS[a_outro]`,
  );
  const concatAInputs =
    Array.from({ length: args.clipPaths.length }, (_, i) => `[a${i}]`).join("") + "[a_outro]";
  chains.push(
    `${concatAInputs}concat=n=${args.clipPaths.length + 1}:v=0:a=1[a_clips]`,
  );

  // Narration tracks: each delayed to its slot start, mixed over.
  const mixInputs: string[] = ["[a_clips]"];
  for (let n = 0; n < args.narrations.length; n++) {
    const narr = args.narrations[n]!;
    const idx = narrationIndices[n]!;
    const delayMs = Math.max(0, Math.round(narr.startS * 1000));
    chains.push(
      `[${idx}:a]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS,` +
        `volume=${FC_NARRATION_VOLUME.toFixed(3)},` +
        `aformat=sample_rates=44100:channel_layouts=stereo,` +
        `adelay=${delayMs}|${delayMs}[a_narr_${n}]`,
    );
    mixInputs.push(`[a_narr_${n}]`);
  }

  // Optional music bed across the whole render.
  if (musicIdx !== null) {
    const fadeStart = Math.max(0, totalDurationS - 0.6);
    chains.push(
      `[${musicIdx}:a]aformat=sample_rates=44100:channel_layouts=stereo,` +
        `volume=${FC_MUSIC_VOLUME.toFixed(3)},` +
        `atrim=duration=${totalDurationS.toFixed(3)},asetpts=PTS-STARTPTS,` +
        `afade=type=out:start_time=${fadeStart.toFixed(3)}:duration=0.6[a_music]`,
    );
    mixInputs.push("[a_music]");
  }

  if (mixInputs.length === 1) {
    chains.push(`[a_clips]anull[a_final]`);
  } else {
    chains.push(
      `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0[a_final]`,
    );
  }

  await runFfmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-y",
      ...inputs,
      "-filter_complex", chains.join(";"),
      "-map", "[v_final]",
      "-map", "[a_final]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-r", "30",
      "-movflags", "+faststart",
      args.outPath,
    ],
    cwd,
  );
}

// ── Influencer compose (segmented render) ──────────────────────────
//
// To keep the outro's lip-sync deterministic regardless of the AI
// middle's variable length, we render each segment to its own
// intermediate mp4 and stitch them with the concat demuxer in a final
// pass. AV sync is locked inside each per-segment ffmpeg invocation;
// the final pass re-encodes once to burn captions and mix in whoosh
// transitions + background music.

import { writeFile } from "node:fs/promises";

const WHOOSH_VOLUME = 0.7;
// Push whoosh #2 (middle→outro transition) slightly after the actual cut.
// At the visual concat boundary the whoosh felt ~3 frames early; landing
// it just inside the outro masks the cut better. Whoosh #1 (intro→middle)
// fires at the boundary since the intro is short and the user didn't
// flag drift there.
const WHOOSH_OUTRO_POST_CUT_S = 0.1;
const INFLUENCER_MUSIC_VOLUME = 0.25; // ~+4 dB louder than the prior 0.15
// Music fades out across the LAST MUSIC_FADE_OUT_S seconds of the middle
// segment (constant declared at the top of this file for narration mode)
// so the fade ends at the moment the outro begins. Outro plays clean.

// Shared ffmpeg encoder flags so all segment intermediates share the
// same codec params. Concat demuxer is happiest when inputs match.
const SEGMENT_ENCODE_ARGS = [
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "23",
  "-pix_fmt", "yuv420p",
  "-r", "30",
  "-c:a", "aac",
  "-b:a", "128k",
  "-ar", "44100",
  "-ac", "2",
  "-movflags", "+faststart",
];

// ── Pass 1: intro segment ──────────────────────────────────────────

export interface ComposeIntroSegmentArgs {
  introPath: string;
  introDurationS: number;
  outPath: string;
}

export async function composeIntroSegment(args: ComposeIntroSegmentArgs): Promise<void> {
  if (args.introDurationS <= 0) {
    throw new Error("composeIntroSegment: introDurationS must be > 0");
  }
  const filter = [
    // Video: scale/crop to 9:16, trim to floor-frame target. fps=30 with
    // a frame-aligned trim gives a clean integer frame count.
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=30,` +
      `trim=duration=${args.introDurationS.toFixed(6)},setpts=PTS-STARTPTS,format=yuv420p[v]`,
    // Audio: aresample at the start to neutralize any source priming /
    // edit-list quirks, then trim+pad to exactly introDurationS.
    `[0:a]aresample=async=1:first_pts=0,atrim=duration=${args.introDurationS.toFixed(6)},asetpts=PTS-STARTPTS,apad=whole_dur=${args.introDurationS.toFixed(6)},aformat=sample_rates=44100:channel_layouts=stereo[a]`,
  ].join(";");

  await runFfmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", args.introPath,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]",
      ...SEGMENT_ENCODE_ARGS,
      args.outPath,
    ],
    dirname(args.outPath),
  );
}

// ── Pass 2: middle segment ─────────────────────────────────────────

export interface ComposeMiddleSegmentArgs {
  middleClipPaths: string[];
  audioPath: string;       // AI middle TTS narration MP3
  audioDurationS: number;  // frame-aligned target (ceil of probed MP3)
  outPath: string;
}

export async function composeMiddleSegment(args: ComposeMiddleSegmentArgs): Promise<void> {
  if (args.middleClipPaths.length === 0) {
    throw new Error("composeMiddleSegment: no middle clips provided");
  }
  if (args.audioDurationS <= 0) {
    throw new Error("composeMiddleSegment: audioDurationS must be > 0");
  }

  // Per-clip duration: each clip plays for an equal share of the AI
  // middle audio. Bounded by the source clip length post-head-trim so
  // we never trim past what the source actually has.
  const maxAvailablePerClip = SOURCE_CLIP_DURATION_S - CLIP_HEAD_TRIM_S;
  const audioShare = args.audioDurationS / args.middleClipPaths.length;
  const middlePerClipS = Math.max(0.5, Math.min(maxAvailablePerClip, audioShare));
  const middleClipsLengthS = middlePerClipS * args.middleClipPaths.length;
  // Safety net: if audio runs longer than what the clips can cover,
  // freeze the last frame so the segment's audio and video lengths stay
  // matched. With 8 × 4.85s capacity this almost never fires.
  const middleVisualPadS = Math.max(0, args.audioDurationS - middleClipsLengthS);

  const inputs: string[] = [];
  for (const clip of args.middleClipPaths) inputs.push("-i", clip);
  const audioInputIndex = args.middleClipPaths.length;
  inputs.push("-i", args.audioPath);

  const chains: string[] = [];
  for (let i = 0; i < args.middleClipPaths.length; i++) {
    chains.push(
      `[${i}:v]trim=start=${CLIP_HEAD_TRIM_S.toFixed(6)}:duration=${middlePerClipS.toFixed(6)},setpts=PTS-STARTPTS,` +
        `scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1,fps=30,format=yuv420p[v_mid${i}]`,
    );
  }
  const midInputs = Array.from({ length: args.middleClipPaths.length }, (_, i) => `[v_mid${i}]`).join("");
  chains.push(`${midInputs}concat=n=${args.middleClipPaths.length}:v=1:a=0[v_mid_cat]`);
  if (middleVisualPadS > 0) {
    chains.push(
      `[v_mid_cat]tpad=stop_mode=clone:stop_duration=${middleVisualPadS.toFixed(6)}[v]`,
    );
  } else {
    chains.push(`[v_mid_cat]null[v]`);
  }
  // Audio: aresample, trim, volume-attenuate for headroom, pad to target.
  chains.push(
    `[${audioInputIndex}:a]aresample=async=1:first_pts=0,atrim=duration=${args.audioDurationS.toFixed(6)},asetpts=PTS-STARTPTS,volume=${NARRATION_VOLUME.toFixed(3)},apad=whole_dur=${args.audioDurationS.toFixed(6)},aformat=sample_rates=44100:channel_layouts=stereo[a]`,
  );

  await runFfmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-y",
      ...inputs,
      "-filter_complex", chains.join(";"),
      "-map", "[v]", "-map", "[a]",
      ...SEGMENT_ENCODE_ARGS,
      args.outPath,
    ],
    dirname(args.outPath),
  );
}

// ── Pass 3: outro segment ──────────────────────────────────────────

export interface ComposeOutroSegmentArgs {
  outroPath: string;
  outroDurationS: number;
  outPath: string;
}

export async function composeOutroSegment(args: ComposeOutroSegmentArgs): Promise<void> {
  if (args.outroDurationS <= 0) {
    throw new Error("composeOutroSegment: outroDurationS must be > 0");
  }
  // Same shape as the intro segment.
  const filter = [
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
      `crop=1080:1920,setsar=1,fps=30,` +
      `trim=duration=${args.outroDurationS.toFixed(6)},setpts=PTS-STARTPTS,format=yuv420p[v]`,
    `[0:a]aresample=async=1:first_pts=0,atrim=duration=${args.outroDurationS.toFixed(6)},asetpts=PTS-STARTPTS,apad=whole_dur=${args.outroDurationS.toFixed(6)},aformat=sample_rates=44100:channel_layouts=stereo[a]`,
  ].join(";");

  await runFfmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", args.outroPath,
      "-filter_complex", filter,
      "-map", "[v]", "-map", "[a]",
      ...SEGMENT_ENCODE_ARGS,
      args.outPath,
    ],
    dirname(args.outPath),
  );
}

// ── Pass 4: final stitch + captions + whoosh + music ───────────────

export interface ComposeInfluencerFinalArgs {
  segmentPaths: string[];        // [intro, middle, outro] in order
  introDurationS: number;        // for whoosh #1 / music start positioning
  middleAudioDurationS: number;  // for whoosh #2 positioning + music end
  assPath: string;
  fontsDir: string;
  whooshPath?: string | null;
  musicPath?: string | null;
  outPath: string;
}

export async function composeInfluencerFinal(args: ComposeInfluencerFinalArgs): Promise<void> {
  if (args.segmentPaths.length !== 3) {
    throw new Error("composeInfluencerFinal: expected 3 segment paths");
  }

  const cwd = dirname(args.assPath);
  const assRel = basename(args.assPath);
  const escapedAss = escapeForFilter(assRel);
  const escapedFonts = escapeForFilter(args.fontsDir);

  // Best-effort optional layers.
  const whooshPath = args.whooshPath && (await fileExists(args.whooshPath))
    ? args.whooshPath
    : null;
  const musicPath = args.musicPath && (await fileExists(args.musicPath))
    ? args.musicPath
    : null;

  // ffmpeg's concat demuxer reads a tiny text file listing the inputs.
  // Paths must be relative to (or absolute for) the location where the
  // demuxer reads them; we use absolute paths so cwd doesn't matter.
  const concatListPath = join(cwd, "segments.txt");
  const concatListBody = args.segmentPaths
    .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
    .join("\n") + "\n";
  await writeFile(concatListPath, concatListBody, "utf8");

  // Inputs: 0 = concat demuxer (audio+video both at index 0), then the
  // optional whoosh and music files.
  const inputs: string[] = [
    "-f", "concat", "-safe", "0", "-i", concatListPath,
  ];
  let nextIdx = 1;
  let whooshIdx: number | null = null;
  if (whooshPath) {
    whooshIdx = nextIdx;
    inputs.push("-i", whooshPath);
    nextIdx += 1;
  }
  let musicIdx: number | null = null;
  if (musicPath) {
    musicIdx = nextIdx;
    // -stream_loop -1 tiles short music tracks across the (middle+outro)
    // window; atrim downstream caps the length to the target.
    inputs.push("-stream_loop", "-1", "-i", musicPath);
    nextIdx += 1;
  }

  const middleStartS = args.introDurationS;
  const outroStartS = args.introDurationS + args.middleAudioDurationS;

  const chains: string[] = [];

  // Video: burn captions on the concatenated stream.
  chains.push(
    `[0:v]subtitles=filename='${escapedAss}':fontsdir='${escapedFonts}',format=yuv420p,setsar=1[v_final]`,
  );

  // Voice track is whatever audio came out of the concat demuxer.
  // amix's first input drives the output duration so the voice goes
  // first. We still aresample defensively to lock the rate.
  chains.push(`[0:a]aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[a_voice]`);
  const mixInputs: string[] = ["[a_voice]"];

  // Whoosh: split one input into two delayed copies. The new file is
  // ~270ms with energy at t=0. Whoosh #1 lands AT the intro→middle cut;
  // whoosh #2 lands WHOOSH_OUTRO_POST_CUT_S after the middle→outro cut
  // because the boundary one felt early in user testing.
  if (whooshIdx !== null) {
    const whoosh1DelayMs = Math.max(0, Math.round(middleStartS * 1000));
    const whoosh2DelayMs = Math.max(0, Math.round((outroStartS + WHOOSH_OUTRO_POST_CUT_S) * 1000));
    chains.push(
      `[${whooshIdx}:a]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS,volume=${WHOOSH_VOLUME.toFixed(3)},aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[w_pre1][w_pre2]`,
    );
    chains.push(`[w_pre1]adelay=${whoosh1DelayMs}|${whoosh1DelayMs}[a_whoosh1]`);
    chains.push(`[w_pre2]adelay=${whoosh2DelayMs}|${whoosh2DelayMs}[a_whoosh2]`);
    mixInputs.push("[a_whoosh1]", "[a_whoosh2]");
  }

  // Music: starts at intro end, runs ONLY through the middle segment,
  // fades out across MUSIC_FADE_OUT_S so the fade ends right at the
  // outro start. The outro plays clean with no music underneath.
  if (musicIdx !== null) {
    const musicDurationS = args.middleAudioDurationS;
    const musicFadeStartS = Math.max(0, musicDurationS - MUSIC_FADE_OUT_S);
    const musicDelayMs = Math.max(0, Math.round(middleStartS * 1000));
    chains.push(
      `[${musicIdx}:a]aresample=async=1:first_pts=0,atrim=duration=${musicDurationS.toFixed(6)},asetpts=PTS-STARTPTS,volume=${INFLUENCER_MUSIC_VOLUME.toFixed(3)},afade=type=out:start_time=${musicFadeStartS.toFixed(6)}:duration=${MUSIC_FADE_OUT_S},aformat=sample_rates=44100:channel_layouts=stereo,adelay=${musicDelayMs}|${musicDelayMs}[a_music]`,
    );
    mixInputs.push("[a_music]");
  }

  if (mixInputs.length === 1) {
    chains.push(`[a_voice]anull[a_final]`);
  } else {
    chains.push(
      `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:normalize=0:dropout_transition=0[a_final]`,
    );
  }

  await runFfmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-y",
      ...inputs,
      "-filter_complex", chains.join(";"),
      "-map", "[v_final]", "-map", "[a_final]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-r", "30",
      "-movflags", "+faststart",
      args.outPath,
    ],
    cwd,
  );
}
