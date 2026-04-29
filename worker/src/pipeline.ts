import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, getJob, setState, updateJob } from "./jobs.js";
import { uploadVideo } from "./r2.js";
import { synthesize } from "./elevenlabs.js";
import { buildAssSubtitles, type SubtitleStyle } from "./subtitles.js";
import { voiceIdFor } from "./voices.js";
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

// Orchestrates the per-job pipeline. Stages are wired up incrementally:
//   Phase B: stub.
//   Phase C (now): ElevenLabs TTS + karaoke ASS subs run for real.
//   Phase D: Pexels Videos download + ffmpeg compose.
//   Phase E: connected end-to-end from Vercel.

export async function runPipeline(jobId: string, req: RenderRequest): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  const workDir = await mkdtemp(join(tmpdir(), `cs-${jobId}-`));

  try {
    // ── Stage: TTS ────────────────────────────────────────────────────
    setState(jobId, "tts", 0.1);
    const tts = await synthesize(req.script, voiceIdFor(req.language), workDir);

    // Build karaoke subtitles from the per-word timestamps and write to disk
    // so the ffmpeg stage (Phase D) can burn them in via subtitles=...
    const ass = buildAssSubtitles(tts.words, SUBTITLE_STYLE);
    const assPath = join(workDir, "subs.ass");
    await writeFile(assPath, ass, "utf8");

    // ── Stage: Footage (Phase D placeholder) ─────────────────────────
    setState(jobId, "footage", 0.4);
    // const clips = await fetchFootage(req.contentType, tts.durationS, workDir);

    // ── Stage: Render (Phase D placeholder) ──────────────────────────
    setState(jobId, "rendering", 0.7);
    // await compose({ clips, mp3Path: tts.mp3Path, assPath, durationS: tts.durationS });

    // ── Stage: Upload (Phase D — wired once final.mp4 exists) ────────
    setState(jobId, "uploading", 0.9);
    // const finalPath = join(workDir, "final.mp4");
    // const url = await uploadVideo(finalPath, `videos/${jobId}.mp4`);

    // Phase D not yet implemented — surface a clear pending state to the UI.
    fail(
      jobId,
      `TTS + subtitles ready (${tts.words.length} words, ${tts.durationS.toFixed(1)}s). Footage compose pending Phase D.`,
    );
    return;

    // When Phase D lands, replace the above with:
    // updateJob(jobId, {
    //   state: "ready",
    //   progress: 1,
    //   videoUrl: url,
    //   durationS: tts.durationS,
    // });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown pipeline error";
    fail(jobId, message);
  } finally {
    // Clean up the per-job workspace.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Suppress unused-import warning for the placeholder branches above.
void uploadVideo;
void updateJob;
