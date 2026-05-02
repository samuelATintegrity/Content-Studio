import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompts/system";
import { CONTENT_TYPE_SPECS } from "./prompts/content-types";
import { buildCaption, stripDashes } from "./copy";
import {
  LANGUAGE_LABELS,
  type ContentType,
  type Language,
  type MessageTheme,
} from "./types";

// Video script generator. The voice rules from the static SYSTEM_PROMPT carry
// over (compliance, "we" not "I", no em dashes, no URLs in body), with extra
// constraints baked in here for spoken-word delivery.

const MODEL = "claude-sonnet-4-6";

// Narration mode now uses the same third-person endorser tone as the
// influencer flow — but since there's no on-camera intro/outro, the
// script itself carries the hook AND the closer. Per-theme bookend
// templates are appended below in buildNarrationUserPrompt.
const NARRATION_VOICE_RULES = `
NARRATION-VIDEO RULES (this is for a 9:16 short-form video with voiceover narration; there is NO on-camera person — the script is the entire talk track from hook to closer):
- PERSPECTIVE — IMPORTANT: the narrator is a third-party endorser, NOT an Agent Match employee. Refer to Agent Match in the THIRD person — say "they", "their team", "Agent Match". NEVER say "we", "us", or "our team". This OVERRIDES the system prompt's "we / our team" guidance.
- Voice: conversational AND energetic, second person to the viewer ("you", "your"), warm and excited like you're telling a friend about something genuinely good. Read aloud by an AI voice. Use contractions ("it's", "they'll", "you're"). Short, punchy sentences — not long lecture-y ones.
- STRUCTURE: every script MUST be hook + body + closer, in one continuous narration.
- The script MUST open with the theme's HOOK (see below) — minor word variation OK, but the framing and intent stay.
- The script MUST end with the theme's CLOSER (see below) — minor word variation OK. Don't add anything after the closer.
- The BODY between hook and closer is 1–3 short sentences delivering the angle's specific value prop. Third-person endorser tone ("here's what I love about Agent Match", "what's cool about them is", "here's something most people don't realize", etc.). Don't pad. Punchy is better.
- Target 70–95 words for the full script (≈ 22–30 seconds at a normal speaking pace).
- DECLARATIVE TONE: end every sentence with a period or exclamation mark — NEVER a question mark. The TTS engine drifts into rising question intonation on short imperatives, so keep clauses confident and grounded.
- NO commas anywhere in the script. If a thought needs a beat, end the sentence with a period and start a fresh one. Comma-separated clauses make the TTS run-on instead of pausing where it should.
- NO em dashes. NO bracketed asides. NO stage directions. NO URLs anywhere except the framing in the closer ("click on the link"). NO hashtags. NO "DM me", "fill out the form".
- When mentioning a numeric rating like "4.8 stars", keep the decimal point exactly as written — the period in "4.8" is essential for the TTS to read it as "four point eight" instead of "forty-eight".
- STAY HIGH-LEVEL — DO NOT GO INTO THE WEEDS:
  - NEVER state specific timelines, dollar amounts, percentages, or step-by-step processes (the only exception is the framing "$0 down" since it's the program name, not a quote, plus the documented "top 10%" and "4.8 stars or higher" claims when relevant).
  - When real constraints exist (income limits, area limits, fund availability, credit considerations), name them GENERICALLY: "area and income limits apply", "credit considerations apply".
  - Always hand off to a professional rather than explaining mechanics — the closer is the natural hand-off, but inside the body you can also say "the right specialist can talk you through whether this fits".
- The "body" field is the IG caption body text (3-5 sentences + 3-5 hashtags), exactly as for static posts. Hashtags on a NEW line at the end. Do not repeat the script verbatim in the caption — the caption complements the video, it doesn't transcribe it.
`.trim();

// Per-theme hook + closer for narration. The narrator MUST open with
// (a minor variation of) the hook and end with (a minor variation of)
// the closer. These are the lines the user shipped after vetting them
// against real renders, so we hand-feed them rather than letting Claude
// invent variants from scratch.
const NARRATION_BOOKENDS: Record<MessageTheme, { hook: string; closer: string }> = {
  agent_match: {
    hook: "If you're looking to buy a home, you've gotta check out Agent Match.",
    closer: "So if you're looking to buy and don't know where to start, click on the link and get connected. Today.",
  },
  dpa: {
    hook: "If you're looking to buy a home but need help with the down payment, then you've gotta start with Agent Match.",
    closer: "So if you're ready to see your options, click the link and get connected. Today.",
  },
};

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

// Map a narration message theme to the content type whose copy assets
// (URL, form line, hashtags, caption framing) should drive the IG body
// + caption rendering. Same idea as the influencer DPA path.
function captionContentTypeFor(theme: MessageTheme): ContentType {
  return theme === "dpa" ? "edu_dpa_local" : "good_agents";
}

function buildAgentMatchNarrationUserPrompt(
  language: Language,
  angleKeys: string[],
): string {
  const spec = CONTENT_TYPE_SPECS["good_agents"];
  const angles = spec.angles.filter((a) => angleKeys.includes(a.key));
  const angleList = angles
    .map((a, i) => `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}`)
    .join("\n");

  const refDocSection = spec.referenceDocument
    ? `\n\nREFERENCE DOCUMENT (rephrase ideas naturally, never copy verbatim, never invent claims beyond this — "top 10%" and "4.8 stars or higher" are the only quantitative claims allowed):\n${spec.referenceDocument}\n`
    : "";

  const { hook, closer } = NARRATION_BOOKENDS.agent_match;

  return `Language: ${LANGUAGE_LABELS[language]}
Topic: ${spec.topic}
Guardrails: ${spec.guardrails}${refDocSection}

THEME-SPECIFIC HOOK (open with a close variation of this exact line):
"${hook}"

THEME-SPECIFIC CLOSER (end with a close variation of this exact line):
"${closer}"

${NARRATION_VOICE_RULES}

Produce one full narration script for each of these angles. Each script must include the hook + a body that lands on this angle + the closer. Preserve the angle key:
${angleList}

Return your results by calling the video_results tool.`;
}

function buildDpaNarrationUserPrompt(language: Language): string {
  const angleList = DPA_ANGLES.map(
    (a, i) => `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}`,
  ).join("\n");

  const { hook, closer } = NARRATION_BOOKENDS.dpa;

  return `Language: ${LANGUAGE_LABELS[language]}
Topic: $0-down / down-payment-assistance education — the narrator is recommending Agent Match to buyers who need help with the down payment because Agent Match's network specializes in these programs.
Guardrails: Stay generic on program mechanics. Names of program categories ($0-down USDA, VA, DPA, local-bank zero-down) are fine; specific dollar amounts, percentages, timelines, or step-by-step processes are NOT. Always hand off to a specialist.

REFERENCE (paraphrase the spirit, never copy verbatim, never invent claims beyond this):
${DPA_REFERENCE_TEMPLATE}

THEME-SPECIFIC HOOK (open with a close variation of this exact line):
"${hook}"

THEME-SPECIFIC CLOSER (end with a close variation of this exact line):
"${closer}"

${NARRATION_VOICE_RULES}

Produce one full narration script for each of these angles. Each script must include the hook + a body that lands on this angle + the closer. Preserve the angle key:
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
  messageTheme: MessageTheme,
  angleOverride?: string[],
): Promise<VideoScript[]> {
  // Theme-driven narration scripts. agent_match samples 3 angles from the
  // good_agents pool (so each batch hits a different value-prop point);
  // dpa uses the fixed 3-angle DPA pool baked into this file.
  const isDpa = messageTheme === "dpa";
  const angleKeys = isDpa
    ? (angleOverride && angleOverride.length > 0
        ? DPA_ANGLES.map((a) => a.key).filter((k) => angleOverride.includes(k))
        : DPA_ANGLES.map((a) => a.key))
    : pickVideoAngles("good_agents", angleOverride);
  if (angleKeys.length === 0) throw new Error("No angles selected");

  const userPrompt = isDpa
    ? buildDpaNarrationUserPrompt(language)
    : buildAgentMatchNarrationUserPrompt(language, angleKeys);

  const captionContentType = captionContentTypeFor(messageTheme);

  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [VIDEO_TOOL],
      tool_choice: { type: "tool", name: VIDEO_TOOL.name },
      messages: [{ role: "user", content: userPrompt }],
    });
    const raw = extractScripts(resp);
    return finalize(raw, language, captionContentType);
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

// DPA-theme angle pool. The influencer recommends Agent Match's matching
// service for buyers who need help with the down payment — the scripts
// rotate through these emphases so the 3 batch videos don't say the same
// thing three times.
const DPA_ANGLES: Array<{ key: string; brief: string }> = [
  {
    key: "dpa_program_breadth",
    brief:
      "Lead with the breadth of programs Agent Match's network handles — $0-down USDA / VA, down payment assistance, local-bank zero-down. The promise is: whatever flavor of help you need, they'll match you with a team that knows it.",
  },
  {
    key: "dpa_save_time",
    brief:
      "Lead with the time-and-frustration save — buyers waste weeks calling agents and lenders who don't actually do these programs. Agent Match skips that hunt by routing you straight to a team that already specializes in your situation.",
  },
  {
    key: "dpa_specialist_match",
    brief:
      "Lead with the specialist-match angle — Agent Match doesn't hand you a generic list, they connect you with one team that already runs $0-down / DPA deals every week. The right specialist beats a generic agent for these programs.",
  },
];

const DPA_REFERENCE_TEMPLATE = `
The influencer's recorded INTRO is roughly: "If you're looking to buy a home but need help with the down payment, you've gotta start with Agent Match."

The recorded OUTRO is roughly: "So if you want to know your options but don't know where to start, click the link and they'll connect you today."

The AI middle should bridge those two cleanly. The canonical message you're paraphrasing for the middle is:

"They'll connect you with the best team for whatever program you need. Whether that's a zero-down USDA or VA loan, a down payment assistance program, or a local bank zero-down program. They do the connection so you don't waste time looking for the wrong team."

Each of the 3 angles below should produce a DIFFERENT middle script that lands on its specific emphasis — don't just paraphrase the canonical message verbatim three times, and don't restate the intro or outro.
`.trim();

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

function buildDpaInfluencerUserPrompt(
  language: Language,
  avatarName: string,
): string {
  const angleList = DPA_ANGLES.map(
    (a, i) => `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}`,
  ).join("\n");

  return `Language: ${LANGUAGE_LABELS[language]}
Topic: $0-down / down-payment-assistance education — the influencer is telling buyers who need help with the down payment that Agent Match will match them with a team that runs these programs every day.
Guardrails: Stay generic on program mechanics. Names of program categories ($0-down USDA, VA, DPA, local-bank zero-down) are fine; specific dollar amounts, percentages, timelines, or step-by-step processes are NOT. Always hand off to a specialist.

REFERENCE (paraphrase the spirit, never copy verbatim, never invent claims beyond this):
${DPA_REFERENCE_TEMPLATE}

The avatar "${avatarName}" is a real-estate INFLUENCER recommending Agent Match to their audience — they are NOT part of the Agent Match team. They've introduced Agent Match in a pre-recorded intro clip and will close out in a pre-recorded outro clip. Your job is the warm, conversational MIDDLE that bridges the two and elaborates on the value prop in the influencer's voice. Refer to Agent Match in the third person ("they", "their team", "Agent Match") — never "we" or "our". Each angle below should produce a DIFFERENT middle script focused on that angle's specific value-prop point.

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
  messageTheme: MessageTheme,
  angleOverride?: string[],
): Promise<InfluencerScript[]> {
  // The agent_match theme reuses the narration-mode angle picker so the
  // 3 videos lean on different value-prop points from good_agents. The dpa
  // theme has its own fixed 3-angle pool (program breadth / save-time /
  // specialist match) baked into this file.
  const isDpa = messageTheme === "dpa";
  const angleKeys = isDpa
    ? DPA_ANGLES.map((a) => a.key)
    : pickVideoAngles(contentType, angleOverride);
  if (angleKeys.length === 0) throw new Error("No angles selected");

  // The IG caption builder looks up content-type config (URL, form line,
  // hashtags). The dpa theme writes about down-payment programs, so route
  // the caption through edu_dpa_local for the right framing — the user's
  // existing dpa caption assets live there.
  const captionContentType: ContentType = isDpa ? "edu_dpa_local" : contentType;

  const userPrompt = isDpa
    ? buildDpaInfluencerUserPrompt(language, avatarName)
    : buildInfluencerUserPrompt(language, contentType, avatarName, angleKeys);

  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [INFLUENCER_TOOL_V2],
      tool_choice: { type: "tool", name: INFLUENCER_TOOL_V2.name },
      messages: [{ role: "user", content: userPrompt }],
    });
    const raw = extractInfluencerScripts(resp);
    return raw.map((r) => ({
      angle: r.angle,
      script: stripDashes(r.script).trim(),
      caption: buildCaption(language, captionContentType, r.body),
    }));
  } catch (e) {
    throw friendlyError(e);
  }
}
