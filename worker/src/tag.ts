// Auto-tag a library clip by sampling its first frame and asking Claude
// vision to pick from a fixed taxonomy. The tags drive search/filter in
// the picker UI so the user can find rooms / subjects quickly without
// scrubbing through thumbnails.
//
// Cost per clip: ~1 Claude vision call with a single small JPEG (~30KB
// after re-encode), well under $0.01.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// Fixed taxonomy. Vision returns ONLY tags from this list. Ethnicity and
// other demographic tags are deliberately excluded — we use these for
// content discovery, not for audience targeting (Fair Housing).
export const TAG_TAXONOMY = [
  // Room types
  "kitchen",
  "bathroom",
  "bedroom",
  "living_room",
  "dining_room",
  "exterior",
  "hallway",
  "office",
  // Subjects
  "agent",
  "loan_officer",
  "couple",
  "family",
  "single_person",
  "multiple_people",
  "no_people",
  // Props / common b-roll
  "keys",
  "paperwork",
  "moving_boxes",
  "computer",
  "phone",
] as const;

const PROMPT = `You are tagging a frame from a real-estate marketing video. Pick ONLY tags that clearly apply from this fixed list. Do not invent new tags.

Tags (use these strings exactly): ${TAG_TAXONOMY.join(", ")}.

Rules:
- Use \`agent\` only if the person looks like a real-estate agent (suit/blazer, gesturing toward a home, holding paperwork or keys, professional setting).
- Use \`loan_officer\` only if the setting suggests financial work (desk + computer, paperwork, banking environment).
- Use \`no_people\` if the frame contains no visible people.
- Be conservative — better to omit an uncertain tag than guess wrong.

Return JSON only, no prose: {"tags":["kitchen","no_people"]}`;

let _anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _anthropic = new Anthropic({ apiKey, maxRetries: 2 });
  return _anthropic;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

async function fetchToFile(url: string, dest: string): Promise<void> {
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");
  const { createWriteStream } = await import("node:fs");
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url} (${res.status})`);
  const stream = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(stream, createWriteStream(dest));
}

function parseTags(raw: string): string[] {
  // Claude sometimes wraps JSON in ```json fences; strip them.
  const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const tags = (parsed as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return [];
  const allowed = new Set<string>(TAG_TAXONOMY);
  return tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase())
    .filter((t) => allowed.has(t));
}

export async function tagClip(url: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "tag-"));
  const videoPath = join(dir, "in.mp4");
  const framePath = join(dir, "frame.jpg");
  try {
    await fetchToFile(url, videoPath);
    // Grab a frame ~0.5s in (skip the very first frame which is often
    // the warmup wobble for Seedance/Kling outputs). Re-encode to JPEG
    // and downscale to 768px on the long edge — plenty for a vision pass,
    // keeps the upload tiny.
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-ss", "0.5",
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", "scale='min(768,iw)':-2",
      "-q:v", "5",
      framePath,
    ]);

    const bytes = await readFile(framePath);
    const b64 = bytes.toString("base64");

    const resp = await client().messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: b64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    return parseTags(text);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
