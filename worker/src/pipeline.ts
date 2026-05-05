import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, getJob, setState, updateJob } from "./jobs.js";
import { uploadVideo } from "./r2.js";
import { synthesize } from "./elevenlabs.js";
import {
  buildAssSubtitles,
  buildMultiSegmentAssSubtitles,
  type SubtitleStyle,
} from "./subtitles.js";
import { voiceIdFor } from "./voices.js";
import { downloadClips } from "./clipDownload.js";
import {
  compose,
  composeFunnyCommercial,
  composeInfluencerFinal,
  composeIntroSegment,
  composeMiddleSegment,
  composeOutroSegment,
} from "./ffmpeg.js";
import { pickMusicTrack, pickSoundEffect } from "./music.js";
import { buildFunnyCommercialSubtitles } from "./subtitles.js";
import { probeBookendDurationS, probeDurationS } from "./probe.js";
import { applyCaptionCutoff, transcribeMediaFile } from "./transcribe.js";
import type { RenderRequest } from "./types.js";
import type { WordTiming } from "./elevenlabs.js";

// Subtitle styling. White all-caps with a strong yellow highlight on the
// currently-spoken word, sitting mid-lower in the 1080x1920 frame and
// entering with a blur fade + small upward slide.
const SUBTITLE_STYLE: SubtitleStyle = {
  primaryColor: "#FFFFFF",
  highlightColor: "#FFD400",
  fontFamily: "Inter",
  fontSize: 96,
  marginV: 850,
  outlineColor: "#000000",
  outlineWidth: 6,
  shadowDepth: 3,
  wordsPerPhrase: 3,
  entranceMs: 280,
  entranceLiftPx: 35,
};

// Bundled fonts and assets live under /app in the Docker runtime image.
const FONTS_DIR = process.env.FONTS_DIR ?? "/app/fonts";

// When the picked-clip flow sends 8 clips, drop the last one if the
// narration is shorter than this many seconds — keeps clip cuts from
// feeling too rapid on shorter videos. 8 stays for 40s+ narrations so
// the audio doesn't outrun the visual track. Mirrors
// PICKED_CLIP_DROP_THRESHOLD_S in src/lib/videoPrompts.ts (kept in
// sync manually since the worker doesn't import from src/).
const PICKED_CLIP_DROP_THRESHOLD_S = 40;
const PICKED_CLIP_DROPPED_COUNT = 7;

export async function runPipeline(jobId: string, req: RenderRequest): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  if (!Array.isArray(req.clipUrls) || req.clipUrls.length === 0) {
    fail(jobId, "clipUrls required");
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), `cs-${jobId}-`));

  try {
    if (req.mode === "influencer") {
      await runInfluencerPipeline(jobId, req, workDir);
      return;
    }

    if (req.mode === "funny_commercial") {
      await runFunnyCommercialPipeline(jobId, req, workDir);
      return;
    }

    // ── Stage: TTS ────────────────────────────────────────────────────
    setState(jobId, "tts", 0.1);
    // Honor an explicit voiceId from the client (e.g. narration now routes
    // through Sarah's avatar voice). Falls back to the language-default
    // env var so any older programmatic enqueue still works.
    const narrationVoiceId = req.voiceId ?? voiceIdFor(req.language);
    const tts = await synthesize(req.script, narrationVoiceId, workDir);
    if (tts.durationS <= 0) {
      throw new Error("ElevenLabs returned zero-duration audio");
    }

    const ass = buildAssSubtitles(tts.words, SUBTITLE_STYLE);
    const assPath = join(workDir, "subs.ass");
    await writeFile(assPath, ass, "utf8");

    // ── Stage: Footage download ──────────────────────────────────────
    // For the picked-clip flow the user selects 8 up-front; if the narration
    // came in shorter than the threshold, drop the trailing clip(s) so each
    // remaining clip plays a bit longer. No-op for from-scratch renders
    // (which always send exactly 5 clips).
    let clipUrlsForRender = req.clipUrls;
    if (
      req.clipUrls.length > PICKED_CLIP_DROPPED_COUNT &&
      tts.durationS < PICKED_CLIP_DROP_THRESHOLD_S
    ) {
      clipUrlsForRender = req.clipUrls.slice(0, PICKED_CLIP_DROPPED_COUNT);
    }
    setState(jobId, "footage", 0.35);
    const clips = await downloadClips(clipUrlsForRender, workDir);

    // ── Stage: Render ────────────────────────────────────────────────
    setState(jobId, "rendering", 0.6);
    const finalPath = join(workDir, "final.mp4");
    const musicPath = await pickMusicTrack();
    await compose({
      clipPaths: clips.map((c) => c.filePath),
      audioPath: tts.mp3Path,
      assPath,
      fontsDir: FONTS_DIR,
      outPath: finalPath,
      audioDurationS: tts.durationS,
      musicPath,
    });

    // ── Stage: Upload ────────────────────────────────────────────────
    setState(jobId, "uploading", 0.9);
    const url = await uploadVideo(finalPath, `videos/${jobId}.mp4`);

    updateJob(jobId, {
      state: "ready",
      progress: 1,
      videoUrl: url,
      durationS: tts.durationS,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown pipeline error";
    fail(jobId, message);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Influencer pipeline: pre-recorded intro + AI-narrated middle + pre-recorded
// outro, all concatenated. No background music. Karaoke captions span all
// three segments — intro/outro words come from ElevenLabs STT, middle
// words from the TTS alignment. Per-bookend captionCutoffPhrase truncates
// captions before brand mentions so the user can drop title cards on top.
async function runInfluencerPipeline(
  jobId: string,
  req: RenderRequest,
  workDir: string,
): Promise<void> {
  if (!req.introClipUrl || !req.outroClipUrl) {
    throw new Error("influencer mode requires introClipUrl and outroClipUrl");
  }

  // ── Stage: TTS (avatar voice) ──────────────────────────────────────
  setState(jobId, "tts", 0.1);
  const voiceId = req.voiceId ?? voiceIdFor(req.language);
  const tts = await synthesize(req.script, voiceId, workDir);
  if (tts.durationS <= 0) {
    throw new Error("ElevenLabs returned zero-duration audio");
  }

  // ElevenLabs returns alignment timestamps where the last word's `endS`
  // can be earlier than the MP3's actual end (the file usually has a
  // small tail of breath/decay/silence past the last spoken word). If we
  // sized the middle segment by `tts.durationS` we'd chop the tail off
  // ("voiceover cut early"). Probe the actual MP3 file for the canonical
  // middle audio length; tts.words still drives caption timing.
  const probedMiddleAudioS = await probeDurationS(tts.mp3Path);

  // ── Stage: Footage download (intro + middle + outro) ───────────────
  setState(jobId, "footage", 0.3);
  const introDir = await mkdtemp(join(workDir, "intro-"));
  const middleDir = await mkdtemp(join(workDir, "middle-"));
  const outroDir = await mkdtemp(join(workDir, "outro-"));
  const [introClips, middleClips, outroClips] = await Promise.all([
    downloadClips([req.introClipUrl], introDir),
    downloadClips(req.clipUrls, middleDir),
    downloadClips([req.outroClipUrl], outroDir),
  ]);
  const introPath = introClips[0]!.filePath;
  const outroPath = outroClips[0]!.filePath;
  const middlePaths = middleClips.map((c) => c.filePath);

  // Frame-align ALL durations to 30fps boundaries before passing to ffmpeg.
  // The fps=30 filter rounds non-frame-aligned trim durations to whole
  // frames internally, which causes audio (sample-precise) and video
  // (frame-precise) to drift by up to ~33ms per segment — across
  // intro+8 middle clips+outro that accumulates into visible AV desync.
  // Floor for bookends so we never trim past either stream's natural
  // length. Ceil for the middle so the audio's tail isn't lost; we'll
  // pad the audio with silence at the end via apad to cover the rounding.
  const FPS = 30;
  const floorFrame = (s: number): number => Math.floor(s * FPS) / FPS;
  const ceilFrame = (s: number): number => Math.ceil(s * FPS) / FPS;

  // Bookends: probe the shorter of (video stream, audio stream), then
  // floor to the nearest 30fps frame boundary.
  const [probedIntroS, probedOutroS] = await Promise.all([
    probeBookendDurationS(introPath),
    probeBookendDurationS(outroPath),
  ]);
  const introDurationS = floorFrame(probedIntroS);
  const outroDurationS = floorFrame(probedOutroS);

  // Middle: round per-clip up to a frame boundary, then 8 × per-clip is
  // automatically frame-aligned too. Audio is padded with silence to
  // match the (slightly longer) total visual length.
  const middlePerClipFrames = Math.max(1, Math.ceil((probedMiddleAudioS / 8) * FPS));
  const middlePerClipS = middlePerClipFrames / FPS;
  const middleAudioDurationS = middlePerClipS * 8;

  // ── Stage: Transcribe bookends + build merged ASS ──────────────────
  // Run intro + outro STT in parallel. STT failures fall back to no
  // captions on that segment so the render still completes — the middle
  // TTS captions are unaffected.
  const [introWords, outroWords] = await Promise.all([
    transcribeBookendSafe(introPath, req.introCaptionCutoffPhrase),
    transcribeBookendSafe(outroPath, req.outroCaptionCutoffPhrase),
  ]);

  // Time offsets in the final concatenated video:
  //   intro:  0
  //   middle: introDurationS
  //   outro:  introDurationS + middleAudioDurationS
  // (audio drives the middle length; visual is split into 8 equal clips
  // adding up to the same number — see composeInfluencer)
  const ass = buildMultiSegmentAssSubtitles(
    [
      { words: introWords, offsetS: 0 },
      { words: tts.words, offsetS: introDurationS },
      {
        words: outroWords,
        offsetS: introDurationS + middleAudioDurationS,
      },
    ],
    SUBTITLE_STYLE,
  );
  const assPath = join(workDir, "subs.ass");
  await writeFile(assPath, ass, "utf8");

  // ── Stage: Render (segmented, 4 ffmpeg passes) ─────────────────────
  // Each segment renders to its own intermediate mp4 with audio+video
  // locked together at output time. The final pass concat-demuxes
  // them, burns captions, and mixes whoosh + music. This isolates
  // outro lip-sync from any timing variation in the middle's TTS.
  const finalPath = join(workDir, "final.mp4");
  const introSegPath = join(workDir, "intro-segment.mp4");
  const middleSegPath = join(workDir, "middle-segment.mp4");
  const outroSegPath = join(workDir, "outro-segment.mp4");

  setState(jobId, "rendering", 0.55);
  await composeIntroSegment({
    introPath,
    introDurationS,
    outPath: introSegPath,
  });

  setState(jobId, "rendering", 0.65);
  await composeMiddleSegment({
    middleClipPaths: middlePaths,
    audioPath: tts.mp3Path,
    audioDurationS: middleAudioDurationS,
    outPath: middleSegPath,
  });

  setState(jobId, "rendering", 0.75);
  await composeOutroSegment({
    outroPath,
    outroDurationS,
    outPath: outroSegPath,
  });

  // Pick a music track + the woosh transition SFX. Both are best-effort
  // — if the assets dir is missing the file, that audio layer is just
  // skipped (compose handles the nullable paths). musicShuffleIndex,
  // when provided, makes the music pick deterministic so the 3 renders
  // in an influencer batch each get a different file (the app passes
  // batchSeed + 0/1/2).
  setState(jobId, "rendering", 0.85);
  const [musicPath, whooshPath] = await Promise.all([
    pickMusicTrack(req.musicShuffleIndex),
    pickSoundEffect("woosh"),
  ]);
  await composeInfluencerFinal({
    segmentPaths: [introSegPath, middleSegPath, outroSegPath],
    introDurationS,
    middleAudioDurationS,
    assPath,
    fontsDir: FONTS_DIR,
    whooshPath,
    musicPath,
    outPath: finalPath,
  });

  // ── Stage: Upload ───────────────────────────────────────────────────
  setState(jobId, "uploading", 0.9);
  const url = await uploadVideo(finalPath, `videos/${jobId}.mp4`);

  const totalDurationS = introDurationS + middleAudioDurationS + outroDurationS;
  updateJob(jobId, {
    state: "ready",
    progress: 1,
    videoUrl: url,
    durationS: totalDurationS,
  });
}

// Funny Commercial pipeline. Scene 1 + Scene 2 are pre-animated mp4s
// the user picked from their libraries; Scene 3 (black + CTA) and
// Scene 4 (logo) are synthesized at compose time. ASS subtitles carry
// both text overlays. No TTS, no STT — text comes pre-formed (and
// pre-translated) from the app.
async function runFunnyCommercialPipeline(
  jobId: string,
  req: RenderRequest,
  workDir: string,
): Promise<void> {
  if (req.clipUrls.length !== 2) {
    throw new Error("funny_commercial requires exactly 2 clipUrls (scene1, scene2)");
  }
  if (!req.fcScene2Text?.trim() || !req.fcScene3Text?.trim()) {
    throw new Error("funny_commercial requires fcScene2Text and fcScene3Text");
  }

  const scene1S = req.fcScene1DurationS ?? 5;
  const scene2S = req.fcScene2DurationS ?? 4;
  const scene3S = req.fcScene3DurationS ?? 3;
  const scene4S = req.fcScene4DurationS ?? 2;

  // ── Stage: Footage download ────────────────────────────────────────
  setState(jobId, "footage", 0.3);
  const downloaded = await downloadClips(req.clipUrls, workDir);
  if (downloaded.length !== 2) {
    throw new Error(`expected 2 clips, downloaded ${downloaded.length}`);
  }
  const scene1Path = downloaded[0]!.filePath;
  const scene2Path = downloaded[1]!.filePath;

  // ── Stage: Build subtitles ────────────────────────────────────────
  // Scene 2 text appears 0.6s into Scene 2 (lets the actor settle in
  // visually) and runs through the end of Scene 2. Scene 3 text shows
  // for the full duration of Scene 3 (subtle 240ms fade in/out via the
  // builder). Times are absolute against the final concatenated video.
  const scene2Start = scene1S + 0.6;
  const scene2End = scene1S + scene2S;
  const scene3Start = scene1S + scene2S;
  const scene3End = scene1S + scene2S + scene3S;
  const ass = buildFunnyCommercialSubtitles(
    [
      { text: req.fcScene2Text, startS: scene2Start, endS: scene2End, placement: "scene2" },
      { text: req.fcScene3Text, startS: scene3Start, endS: scene3End, placement: "scene3" },
    ],
    {
      fontFamily: "Geist",
      scene2FontSize: 88,
      scene3FontSize: 96,
      scene2MarginV: 240,
      outlineWidth: 5,
      shadowDepth: 4,
      fadeMs: 240,
    },
  );
  const assPath = join(workDir, "fc-subs.ass");
  await writeFile(assPath, ass, "utf8");

  // ── Stage: Render ──────────────────────────────────────────────────
  setState(jobId, "rendering", 0.6);
  const finalPath = join(workDir, "final.mp4");
  // Music is opt-in. The muffled-noise gag IS the audio for Scenes 1+2;
  // an underlying music bed often steps on the joke. Default off.
  const musicPath = req.fcMusicTrackUrl
    ? await downloadMusicByUrl(req.fcMusicTrackUrl, workDir).catch(() => null)
    : null;

  await composeFunnyCommercial({
    scene1Path,
    scene2Path,
    assPath,
    fontsDir: FONTS_DIR,
    outPath: finalPath,
    scene1DurationS: scene1S,
    scene2DurationS: scene2S,
    scene3DurationS: scene3S,
    scene4DurationS: scene4S,
    musicPath,
  });

  // ── Stage: Upload ─────────────────────────────────────────────────
  setState(jobId, "uploading", 0.9);
  const url = await uploadVideo(finalPath, `videos/${jobId}.mp4`);
  const totalDurationS = scene1S + scene2S + scene3S + scene4S;
  updateJob(jobId, { state: "ready", progress: 1, videoUrl: url, durationS: totalDurationS });
}

// Best-effort fetch + write a music URL into the work dir so ffmpeg
// can feed it as a local file. The shared downloadClips helper is
// designed for video; we use a plain fetch here because mp3 doesn't
// need probing.
async function downloadMusicByUrl(url: string, workDir: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`music fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = join(workDir, "fc-music.mp3");
  await writeFile(path, buf);
  return path;
}

// Transcribe a bookend file and apply the optional cutoff phrase. Returns
// [] on STT failure so the caller can render uncaptioned over that segment
// rather than failing the whole job.
async function transcribeBookendSafe(
  filePath: string,
  cutoffPhrase: string | undefined,
): Promise<WordTiming[]> {
  try {
    const words = await transcribeMediaFile(filePath);
    return applyCaptionCutoff(words, cutoffPhrase);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      `[influencer] STT failed for ${filePath}; rendering without bookend captions.`,
      e,
    );
    return [];
  }
}
