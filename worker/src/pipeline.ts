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
import { compose, composeInfluencer } from "./ffmpeg.js";
import { pickMusicTrack } from "./music.js";
import { probeDurationS } from "./probe.js";
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

    // ── Stage: TTS ────────────────────────────────────────────────────
    setState(jobId, "tts", 0.1);
    const tts = await synthesize(req.script, voiceIdFor(req.language), workDir);
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
  // ("voiceover cut early") AND the audio/video lengths would diverge
  // slightly, pushing the outro out of sync. Use the actual file
  // duration as the canonical middle audio length; keep `tts.words` for
  // caption timing since those word timestamps stay valid within the file.
  const middleAudioDurationS = await probeDurationS(tts.mp3Path);

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

  const [introDurationS, outroDurationS] = await Promise.all([
    probeDurationS(introPath),
    probeDurationS(outroPath),
  ]);

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

  // ── Stage: Render ───────────────────────────────────────────────────
  setState(jobId, "rendering", 0.6);
  const finalPath = join(workDir, "final.mp4");
  await composeInfluencer({
    introPath,
    middleClipPaths: middlePaths,
    outroPath,
    introDurationS,
    outroDurationS,
    audioPath: tts.mp3Path,
    audioDurationS: middleAudioDurationS,
    assPath,
    fontsDir: FONTS_DIR,
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
