import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, getJob, setState, updateJob } from "./jobs.js";
import { uploadVideo } from "./r2.js";
import { synthesize, type WordTiming } from "./elevenlabs.js";
import { buildAssSubtitles, type SubtitleStyle, type TitleSpan } from "./subtitles.js";
import { voiceIdFor } from "./voices.js";
import { downloadClips } from "./clipDownload.js";
import { compose } from "./ffmpeg.js";
import { pickMusicTrack } from "./music.js";
import type { RenderRequest, TitleMoment } from "./types.js";

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

// Title-card timing knobs.
const TITLE_LEAD_IN_S = 0.1;     // small lead so the title is visible just before the spoken phrase
const TITLE_TAIL_S = 0.2;        // hold past the spoken phrase so the eye finishes reading
const TITLE_MIN_DURATION_S = 0.6;// for very-short phrases ("USDA" is ~0.4s) extend so it's readable
const TITLE_MAX_PER_VIDEO = 2;   // hard cap (Claude is told 0–2; defensive)

// Lower-case + collapse to alphanumerics + spaces so phrase-matching survives
// punctuation, ALL-CAPS, hyphens, etc.
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Find the first window of consecutive words whose concatenation matches
// the (normalized) phrase. Returns [startWordIdx, endWordIdx] inclusive,
// or null if no match.
function findPhraseSpan(words: WordTiming[], phrase: string): [number, number] | null {
  const target = normalizeForMatch(phrase);
  if (!target) return null;
  const targetTokens = target.split(" ");
  const n = targetTokens.length;
  if (n === 0) return null;

  const normWords = words.map((w) => normalizeForMatch(w.word));
  // Drop empty (punctuation-only) tokens but remember original indexes.
  const usable: { idx: number; tok: string }[] = [];
  for (let i = 0; i < normWords.length; i++) {
    const t = normWords[i];
    if (t) usable.push({ idx: i, tok: t });
  }

  for (let i = 0; i + n <= usable.length; i++) {
    let ok = true;
    for (let k = 0; k < n; k++) {
      const u = usable[i + k];
      if (!u || u.tok !== targetTokens[k]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const first = usable[i]!;
      const last = usable[i + n - 1]!;
      return [first.idx, last.idx];
    }
  }
  return null;
}

// Resolve Claude's titleMoments into concrete on-screen time spans using
// the word-level timings from ElevenLabs. Drops moments that don't match
// (script edits, hallucinated phrases) and caps at TITLE_MAX_PER_VIDEO.
// Spans are clamped/extended to a minimum readable duration.
function resolveTitleSpans(words: WordTiming[], moments: TitleMoment[] | undefined): TitleSpan[] {
  if (!moments || moments.length === 0 || words.length === 0) return [];
  const out: TitleSpan[] = [];
  for (const m of moments) {
    if (out.length >= TITLE_MAX_PER_VIDEO) break;
    const range = findPhraseSpan(words, m.phrase);
    if (!range) continue;
    const [a, b] = range;
    const wa = words[a];
    const wb = words[b];
    if (!wa || !wb) continue;
    const startS = wa.startS;
    let endS = wb.endS;
    if (endS - startS < TITLE_MIN_DURATION_S) endS = startS + TITLE_MIN_DURATION_S;
    out.push({
      startS,
      endS,
      label: (m.label || m.phrase).trim(),
      leadInS: TITLE_LEAD_IN_S,
      tailS: TITLE_TAIL_S,
    });
  }
  // Drop overlaps (defensive — Claude shouldn't pick adjacent phrases).
  out.sort((a, b) => a.startS - b.startS);
  for (let i = 1; i < out.length; i++) {
    const cur = out[i];
    const prev = out[i - 1];
    if (cur && prev && cur.startS < prev.endS) {
      out.splice(i, 1);
      i--;
    }
  }
  return out;
}

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

    const titleSpans = resolveTitleSpans(tts.words, req.titleMoments);
    const ass = buildAssSubtitles(tts.words, SUBTITLE_STYLE, titleSpans);
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
