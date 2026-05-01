import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, getJob, setState, updateJob } from "./jobs.js";
import { uploadVideo } from "./r2.js";
import { synthesize } from "./elevenlabs.js";
import { buildAssSubtitles, type SubtitleStyle } from "./subtitles.js";
import { voiceIdFor } from "./voices.js";
import { downloadClips } from "./clipDownload.js";
import { compose } from "./ffmpeg.js";
import { pickMusicTrack } from "./music.js";
import type { RenderRequest } from "./types.js";

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
