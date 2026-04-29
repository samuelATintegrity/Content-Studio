import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, getJob, setState, updateJob } from "./jobs.js";
import { uploadVideo } from "./r2.js";
import { synthesize } from "./elevenlabs.js";
import { buildAssSubtitles, type SubtitleStyle } from "./subtitles.js";
import { voiceIdFor } from "./voices.js";
import { fetchFootage } from "./pexelsVideo.js";
import { compose } from "./ffmpeg.js";
import type { RenderRequest } from "./types.js";

// Brand-aligned subtitle defaults. White base text with the same accent
// highlight used in the static composer's bands.
const SUBTITLE_STYLE: SubtitleStyle = {
  primaryColor: "#FFFFFF",
  highlightColor: "#EEF4ED",
  fontFamily: "Inter",
  fontSize: 72,
  marginV: 1700,
  outlineColor: "#000000",
  outlineWidth: 4,
  shadowDepth: 2,
  wordsPerPhrase: 3,
};

// Bundled fonts live under /app/fonts in the Docker runtime image.
const FONTS_DIR = process.env.FONTS_DIR ?? "/app/fonts";

// Pick a number of clips so each plays for ~6.5s of the narration, bounded
// to [3, 8] so we don't over-fetch on short scripts or under-cut on long ones.
function chooseClipCount(durationS: number): number {
  const ideal = Math.round(durationS / 6.5);
  return Math.max(3, Math.min(8, ideal));
}

export async function runPipeline(jobId: string, req: RenderRequest): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

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

    // ── Stage: Footage ───────────────────────────────────────────────
    setState(jobId, "footage", 0.35);
    const clipCount = chooseClipCount(tts.durationS);
    const clips = await fetchFootage(req.contentType, clipCount, workDir);
    if (clips.length === 0) {
      throw new Error("Pexels returned no clips for this content type");
    }

    // ── Stage: Render ────────────────────────────────────────────────
    setState(jobId, "rendering", 0.6);
    const finalPath = join(workDir, "final.mp4");
    await compose({
      clipPaths: clips.map((c) => c.filePath),
      audioPath: tts.mp3Path,
      assPath,
      fontsDir: FONTS_DIR,
      outPath: finalPath,
      audioDurationS: tts.durationS,
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
    // Clean up the per-job workspace.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
