import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompts/system";
import { CONTENT_TYPE_SPECS } from "./prompts/content-types";
import { buildCaption, stripDashes } from "./copy";
import { LANGUAGE_LABELS, type ContentType, type Language } from "./types";

// Video script generator. The voice rules from the static SYSTEM_PROMPT carry
// over (compliance, "we" not "I", no em dashes, no URLs in body), with extra
// constraints baked in here for spoken-word delivery.

const MODEL = "claude-sonnet-4-6";

const VIDEO_VOICE_RULES = `
VIDEO-SPECIFIC RULES (this is for a 9:16 short-form video with voiceover narration):
- The "script" is read aloud by an AI voice. It MUST sound natural when spoken — short clauses, conversational rhythm.
- Hook in the FIRST 6 WORDS of the script. The opener must grab attention immediately (a question, a myth-bust, a bold fact, a vivid statement).
- Target 60-75 words for the script (≈ 20-25 seconds at a normal speaking pace). Tight is better than loose.
- DO NOT use a personal-story or persona opener. Banned phrasings: "Meet [Name]", "[Name] bought…", "When [Name]…", "Let me tell you about…", "I had a client…", "Imagine if you…". The video should explain a topic, not narrate a fictional individual's journey.
- The script MUST end with this exact closer (in the requested language, translated naturally): "Click the link to get connected today." Don't add anything after it.
- NO URLs, NO hashtags, NO "fill out the form", NO "DM me" anywhere in the SCRIPT — the only CTA is the closer above.
- NO numbers spelled as digits where it sounds awkward ("two thousand" reads better than "2000" sometimes — use your judgment).
- NO em dashes anywhere. NO bracketed asides. NO stage directions like "(pause)".
- DECLARATIVE TONE: every sentence in the script must end with a period (or exclamation mark for emphasis) — NEVER a question mark. Statements only. The TTS engine drifts into rising question intonation on short imperatives, so keep clauses confident and grounded. If you want to pose a thought, phrase it as a statement ("Most buyers don't know this." NOT "Did you know?"). The closer especially must read flat and final.
- The "caption" is the IG body text (3-5 sentences + 3-5 hashtags), exactly as for static posts. Hashtags on a NEW line at the end.
- Do not repeat the script verbatim in the caption — the caption complements the video, it doesn't transcribe it.
`.trim();

interface RawVideoScript {
  angle: string;
  script: string;
  body: string;
}

const VIDEO_TOOL = {
  name: "video_results",
  description: "Return the generated video scripts. Call this exactly once with one entry per requested angle.",
  input_schema: {
    type: "object" as const,
    properties: {
      scripts: {
        type: "array",
        description: "One entry per requested angle, in the same order.",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo back the angle key you were given." },
            script: { type: "string", description: "Voiceover narration: 80-100 words, hook in first 6 words, no URLs, no hashtags, no em dashes." },
            body: { type: "string", description: "IG caption body in the requested language: 3-5 sentences, then a newline and 3-5 hashtags. No URLs. No DM/CTA language." },
          },
          required: ["angle", "script", "body"],
        },
      },
    },
    required: ["scripts"],
  },
};

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey, maxRetries: 4 });
  return _client;
}

function friendlyError(e: unknown): Error {
  if (e instanceof Anthropic.APIError) {
    if (e.status >= 500) return new Error(`Anthropic API is having a moment (${e.status}). Try again in a few seconds.`);
    if (e.status === 429) return new Error("Anthropic rate limit hit. Wait a minute and try again.");
    if (e.status === 401 || e.status === 403) return new Error("Anthropic key was rejected.");
    return new Error(`Anthropic ${e.status}: ${e.message}`);
  }
  return e instanceof Error ? e : new Error("Unknown error from Claude");
}

// Pick 3 angles from the content type's pool, weighted toward the more
// hook-friendly ones (skip pure-CTA angles when alternatives exist).
function pickVideoAngles(contentType: ContentType, override?: string[]): string[] {
  const spec = CONTENT_TYPE_SPECS[contentType];
  const all = spec.angles.map((a) => a.key);
  if (override && override.length > 0) {
    return all.filter((k) => override.includes(k));
  }
  // Prefer non-cta angles for video (CTAs read as filler when spoken). Fall
  // back to including them if there aren't enough alternatives.
  const nonCta = all.filter((k) => !k.startsWith("cta_"));
  const pool = nonCta.length >= 3 ? nonCta : all;
  // Random sample of 3.
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function buildUserPrompt(language: Language, contentType: ContentType, angleKeys: string[]): string {
  const spec = CONTENT_TYPE_SPECS[contentType];
  const angles = spec.angles.filter((a) => angleKeys.includes(a.key));

  const angleList = angles
    .map((a, i) => `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}`)
    .join("\n");

  const refDocSection = spec.referenceDocument
    ? `\n\nREFERENCE DOCUMENT (rephrase ideas naturally, never copy verbatim, never invent claims beyond this):\n${spec.referenceDocument}\n`
    : "";

  return `Language: ${LANGUAGE_LABELS[language]}
Topic: ${spec.topic}
Guardrails: ${spec.guardrails}${refDocSection}

${VIDEO_VOICE_RULES}

Produce one video for each of these angles, preserving the angle key:
${angleList}

Return your results by calling the video_results tool.`;
}

function extractScripts(resp: Anthropic.Messages.Message): RawVideoScript[] {
  const tu = resp.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") throw new Error("Claude did not call the video_results tool");
  const input = tu.input as { scripts?: RawVideoScript[] };
  if (!input.scripts || !Array.isArray(input.scripts)) {
    throw new Error("video_results tool call missing 'scripts' array");
  }
  return input.scripts;
}

export interface VideoScript {
  angle: string;
  script: string;
  caption: string;
}

function finalize(raw: RawVideoScript[], language: Language, contentType: ContentType): VideoScript[] {
  return raw.map((r) => ({
    angle: r.angle,
    script: stripDashes(r.script).trim(),
    caption: buildCaption(language, contentType, r.body),
  }));
}

export async function generateVideoScripts(
  language: Language,
  contentType: ContentType,
  angleOverride?: string[],
): Promise<VideoScript[]> {
  const angleKeys = pickVideoAngles(contentType, angleOverride);
  if (angleKeys.length === 0) throw new Error("No angles selected");

  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [VIDEO_TOOL],
      tool_choice: { type: "tool", name: VIDEO_TOOL.name },
      messages: [{ role: "user", content: buildUserPrompt(language, contentType, angleKeys) }],
    });
    const raw = extractScripts(resp);
    return finalize(raw, language, contentType);
  } catch (e) {
    throw friendlyError(e);
  }
}
