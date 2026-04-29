import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, getJob, setState, updateJob } from "./jobs.js";
import { uploadVideo } from "./r2.js";
import type { RenderRequest } from "./types.js";

// Orchestrates the per-job pipeline. Stages are wired up incrementally:
//   Phase B (now): just upload a stub MP4 to R2 to prove the deploy works.
//   Phase C: ElevenLabs TTS + karaoke ASS subs.
//   Phase D: Pexels Videos download + ffmpeg compose.
//   Phase E: connected end-to-end from Vercel.

export async function runPipeline(jobId: string, _req: RenderRequest): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  const workDir = await mkdtemp(join(tmpdir(), `cs-${jobId}-`));

  try {
    // ── Stage: TTS (Phase C placeholder) ─────────────────────────────
    setState(jobId, "tts", 0.1);
    // const tts = await synthesize(req.script, voiceIdFor(req.language), workDir);

    // ── Stage: Footage (Phase D placeholder) ─────────────────────────
    setState(jobId, "footage", 0.3);
    // const clips = await fetchFootage(req.contentType, 4, workDir);

    // ── Stage: Render (Phase D placeholder) ──────────────────────────
    setState(jobId, "rendering", 0.6);
    // await compose({ ...args });

    // ── Stage: Upload (Phase B — wire as soon as R2 creds available) ─
    setState(jobId, "uploading", 0.9);
    // const finalPath = join(workDir, "final.mp4");
    // const url = await uploadVideo(finalPath, `videos/${jobId}.mp4`);

    // For now, mark the job as failed with a clear message so the UI can
    // distinguish "pipeline not ready" from a real failure.
    fail(jobId, "Render pipeline is still under construction (Phase B).");
    return;

    // When real wiring lands, replace the above with:
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

// Suppress unused-import warning for the placeholder branch above.
void uploadVideo;
void updateJob;
