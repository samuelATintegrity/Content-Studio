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
- STAY HIGH-LEVEL — DO NOT GO INTO THE WEEDS: the script's job is to introduce the topic and get the viewer excited to learn more, NOT to educate them fully. The viewer should come away thinking "this option exists, I might qualify, the right team can help me figure out the details" — never "here's exactly how it works."
  - NEVER state specific timelines (no "60-90 days", "30 days to close", "in 6 weeks"). If timing comes up, say "the timeline is more straightforward than most people think" or hand off to the team.
  - NEVER state specific dollar amounts (the only allowed money phrasing is the framing "$0 down"; no specific grant sizes, fees, closing costs, etc.).
  - NEVER state specific percentages (interest rates, down-payment percentages, minimum credit scores, income-limit percentages).
  - NEVER walk through a step-by-step process. Big-picture only.
  - When real constraints exist (income limits, area limits, fund availability, credit considerations), name them GENERICALLY: "area and income limits apply", "credit considerations apply", "funds are limited each year".
  - Always hand off to a professional rather than explaining the mechanics: "the right team can talk you through whether this fits your situation", "an expert can walk you through what fits", etc. THEN the closer.
  - This rule overrides the angle's brief. If the angle brief mentions a timeline, fees, percentages, minimum scores, or income-limit specifics, IGNORE those specifics in the narration — keep the angle's TOPIC but stay high-level. The IG caption (body field) can carry slightly more nuance, but still no invented numbers.
  - Mental template (don't copy verbatim, but match the shape): "[Hook / myth-bust]. [The basic idea in 1–2 sentences]. [Generic constraints: 'X and Y apply']. The right team can [help / discuss your options]. Click the link to get connected today."
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

// ── Influencer middle script ─────────────────────────────────────────
//
// Influencer mode produces a short conversational paragraph that bridges a
// pre-recorded avatar intro and outro. The avatar's recorded intro is the
// hook ("if you're buying a home, you need to check out Agent Match") and
// their recorded outro is the closer — so the middle script doesn't need
// either, just a warm second-person elaboration of the value prop.

const INFLUENCER_VOICE_RULES = `
INFLUENCER-MIDDLE-SCRIPT RULES (this script is the AI-generated middle of a 9:16 video; the intro and outro are pre-recorded videos of an influencer talking on camera):
- PERSPECTIVE — IMPORTANT: the influencer is a third-party endorser, NOT an Agent Match employee. Refer to Agent Match in the THIRD person — say "they", "their team", "Agent Match". NEVER say "we", "us", or "our team". This OVERRIDES the system prompt's "we / our team" guidance, which assumes a company voice; here the speaker is recommending Agent Match to their audience as an outsider.
- Voice: conversational AND energetic, second person to the viewer ("you", "your"), warm and excited like you're telling a friend about something genuinely good. Read aloud by an AI voice in the influencer's avatar voice. Use contractions ("it's", "they'll", "you're"). Short, punchy sentences — not long lecture-y ones.
- DO NOT include a hook opener — the intro clip is the hook. Start mid-conversation as if the avatar just finished saying "you've gotta check out Agent Match".
- DO NOT include a verbal closer — the outro clip is the closer. NEVER say "click the link", "go to", any URL, hashtags, "DM me", or "fill out the form".
- Target 45–60 words (≈ 15–20 seconds at a normal speaking pace). Tight is better.
- DECLARATIVE TONE: end every sentence with a period or exclamation mark — NEVER a question mark. The TTS engine drifts into rising question intonation on short imperatives, so keep clauses confident and grounded.
- NO commas anywhere in the script. If a thought needs a beat, end the sentence with a period and start a fresh one. Comma-separated clauses make the TTS run-on instead of pausing where it should.
- NO em dashes. NO bracketed asides. NO stage directions.
- When mentioning a numeric rating like "4.8 stars", keep the decimal point exactly as written — the period in "4.8" is essential for the TTS to read it as "four point eight" instead of "forty-eight".
- WHAT TO COVER (lean into the unique value props — the script must feel like the AI middle is selling THIS specific service, not generic real estate):
  - Vetted-agent angle: Agent Match only connects you with proven top-performing agents who've been interviewed and reviewed. Not part-time, not random.
  - Specialty-matching angle: if you need an agent familiar with $0 down programs, USDA loans, down payment assistance, language matching, or any other specific situation, they connect you with someone who actually specializes in that. You don't have to figure it out yourself.
  - Pick ONE or TWO of those angles per script — don't try to cram both. Keep it conversational, not exhaustive.
- STAY HIGH-LEVEL — DO NOT GO INTO THE WEEDS:
  - NEVER state specific timelines, dollar amounts, percentages, or step-by-step processes (the only exception is the framing "$0 down" since it's the program name, not a quote).
  - When real constraints exist (income limits, area limits, fund availability, credit considerations), name them GENERICALLY: "area and income limits apply", "credit considerations apply".
  - Always hand off to a professional rather than explaining mechanics: "the right specialist can talk you through whether this fits".
- Mental shape (don't copy verbatim, just match the energy): "Honestly, here's what I love. [Punchy specialty/vetted point]. [Quick example, plain-spoken]. They'll connect you with someone who actually does this every day."
- The "caption" is the IG body text (3-5 sentences + 3-5 hashtags), exactly as for static posts. Hashtags on a NEW line at the end. Do not repeat the script verbatim in the caption.
`.trim();

interface RawInfluencerAngleScript {
  angle: string;
  script: string;
  body: string;
}

const INFLUENCER_TOOL_V2 = {
  name: "influencer_middle_results",
  description:
    "Return one conversational middle script per requested angle. Call this exactly once with one entry per angle.",
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
            script: {
              type: "string",
              description:
                "Voiceover middle script: 45-60 words, second-person, no hook, no closer, no URLs, no hashtags, no em dashes, no commas.",
            },
            body: {
              type: "string",
              description:
                "IG caption body in the requested language: 3-5 sentences, then a newline and 3-5 hashtags. No URLs. No DM/CTA language.",
            },
          },
          required: ["angle", "script", "body"],
        },
      },
    },
    required: ["scripts"],
  },
};

function buildInfluencerUserPrompt(
  language: Language,
  contentType: ContentType,
  avatarName: string,
  angleKeys: string[],
): string {
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

The avatar "${avatarName}" is a real-estate INFLUENCER recommending Agent Match to their audience — they are NOT part of the Agent Match team and do not work there. They've introduced Agent Match in a pre-recorded clip and will close out in a pre-recorded outro. Your job is the warm, conversational middle that elaborates on the value prop in the influencer's voice. Refer to Agent Match in the third person ("they", "their team", "Agent Match") — never "we" or "our". Each angle below should produce a DIFFERENT middle script focused on that angle's specific value-prop point — don't reword the same paragraph three times.

${INFLUENCER_VOICE_RULES}

Produce one middle script for each of these angles, preserving the angle key:
${angleList}

Return your results by calling the influencer_middle_results tool.`;
}

function extractInfluencerScripts(resp: Anthropic.Messages.Message): RawInfluencerAngleScript[] {
  const tu = resp.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") {
    throw new Error("Claude did not call the influencer_middle_results tool");
  }
  const input = tu.input as { scripts?: RawInfluencerAngleScript[] };
  if (!Array.isArray(input.scripts) || input.scripts.length === 0) {
    throw new Error("influencer_middle_results tool call missing 'scripts' array");
  }
  return input.scripts;
}

export interface InfluencerScript {
  angle: string;
  script: string;
  caption: string;
}

export async function generateInfluencerMiddleScripts(
  language: Language,
  contentType: ContentType,
  avatarName: string,
  angleOverride?: string[],
): Promise<InfluencerScript[]> {
  // Reuse the narration-mode angle picker so the influencer flow gets the
  // same "3 random non-CTA angles" behavior — each video then leans on a
  // genuinely different value-prop point.
  const angleKeys = pickVideoAngles(contentType, angleOverride);
  if (angleKeys.length === 0) throw new Error("No angles selected");

  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [INFLUENCER_TOOL_V2],
      tool_choice: { type: "tool", name: INFLUENCER_TOOL_V2.name },
      messages: [
        {
          role: "user",
          content: buildInfluencerUserPrompt(language, contentType, avatarName, angleKeys),
        },
      ],
    });
    const raw = extractInfluencerScripts(resp);
    return raw.map((r) => ({
      angle: r.angle,
      script: stripDashes(r.script).trim(),
      caption: buildCaption(language, contentType, r.body),
    }));
  } catch (e) {
    throw friendlyError(e);
  }
}
