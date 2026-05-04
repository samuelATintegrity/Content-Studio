import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompts/system";
import { CONTENT_TYPE_SPECS } from "./prompts/content-types";
import { buildCaption, CTA_TEXT, stripDashes } from "./copy";
import {
  LANGUAGE_LABELS,
  type ContentType,
  type GenerateBatchResponse,
  type GraphicTemplate,
  type Language,
} from "./types";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  _client = new Anthropic({
    apiKey,
    // Default is 2; bump to 4 so a single transient 5xx doesn't kill a batch.
    maxRetries: 4,
  });
  return _client;
}

function friendlyError(e: unknown): Error {
  if (e instanceof Anthropic.APIError) {
    if (e.status >= 500) {
      return new Error(
        `Anthropic API is having a moment (${e.status}). Try Generate again in a few seconds. (request ${e.headers?.["request-id"] ?? "n/a"})`,
      );
    }
    if (e.status === 429) {
      return new Error("Anthropic rate limit hit. Wait a minute and try again.");
    }
    if (e.status === 401 || e.status === 403) {
      return new Error("Anthropic key was rejected. Check ANTHROPIC_API_KEY in .env.local.");
    }
    return new Error(`Anthropic ${e.status}: ${e.message}`);
  }
  if (e instanceof Error) return e;
  return new Error("Unknown error from Claude");
}

interface RawPost {
  angle: string;
  headline: string;
  body: string;
}

const POST_TOOL = {
  name: "post_results",
  description: "Return the generated social media posts. Call this exactly once with one entry per requested angle.",
  input_schema: {
    type: "object" as const,
    properties: {
      posts: {
        type: "array",
        description: "One entry per requested angle, in the same order.",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo back the angle key you were given." },
            headline: { type: "string", description: "Top-band headline, max 4 words, no emojis." },
            body: { type: "string", description: "3-5 sentence post body in the requested language. End with a newline and 3-5 hashtags. No URLs, no DM/CTA language, no em dashes." },
          },
          required: ["angle", "headline", "body"],
        },
      },
    },
    required: ["posts"],
  },
};

// Static batches always produce exactly this many posts (4 fresh AI + 4
// previously generated + 2 stock = 10 image slots). Exposed so the UI
// can keep the slot math in sync.
export const STATIC_BATCH_POSTS = 10;

function buildUserPrompt(language: Language, contentType: ContentType, anglesOverride?: string[]): string {
  const spec = CONTENT_TYPE_SPECS[contentType];
  const baseAngles = anglesOverride
    ? spec.angles.filter((a) => anglesOverride.includes(a.key))
    : spec.angles;

  // Cycle the angle list out to STATIC_BATCH_POSTS so Claude returns exactly
  // that many posts. If the content type already has 10+ angles, take the
  // first 10. If fewer, repeat angles (Claude will produce different
  // headlines for each repeat — the prompt below tells it to vary openers).
  const angles =
    baseAngles.length === 0
      ? []
      : Array.from({ length: STATIC_BATCH_POSTS }, (_, i) => baseAngles[i % baseAngles.length]);

  const angleList = angles
    .map(
      (a, i) =>
        `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}\n   headline_hint: "${a.headlineHint}" (use this phrasing or a close natural variant. Stay tight to the hint's meaning and topic anchor; only swap synonyms that fit the angle. Across the batch, vary openers slightly so the 10 headlines don't all start with the same word — but only use synonyms that read naturally for this specific topic. If the SAME angle appears more than once in this list, write a DIFFERENT headline + body for each occurrence — same angle, different wording.)`,
    )
    .join("\n");

  const refDocSection = spec.referenceDocument
    ? `\n\nREFERENCE DOCUMENT (this is the source of truth for any specific claims; rephrase the ideas naturally in the post body, do NOT copy sentences verbatim, do NOT invent numbers or claims beyond what's here):\n${spec.referenceDocument}\n`
    : "";

  return `Language: ${LANGUAGE_LABELS[language]}
Topic: ${spec.topic}
Guardrails: ${spec.guardrails}${refDocSection}

Produce one post for each of these angles, preserving the angle key:
${angleList}

Reminder: every headline MUST contain the topic anchor (e.g. "$0 down", "USDA", "DPA", "your language", "agent"). Translate the headline into the requested language while keeping the anchor intact (e.g. "$0 Down" or "agent" stays as the literal anchor even in Tagalog/Spanish/Mandarin posts where the rest of the headline is translated).

Return your results by calling the post_results tool.`;
}

function extractToolPosts(resp: Anthropic.Messages.Message): RawPost[] {
  const tu = resp.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") {
    throw new Error("Claude did not call the post_results tool");
  }
  const input = tu.input as { posts?: RawPost[] };
  if (!input.posts || !Array.isArray(input.posts)) {
    throw new Error("post_results tool call missing 'posts' array");
  }
  return input.posts;
}

function finalizePosts(raw: RawPost[], language: Language, contentType: ContentType) {
  return raw.map((p) => ({
    angle: p.angle,
    headline: stripDashes(p.headline).trim(),
    cta: CTA_TEXT[language],
    caption: buildCaption(language, contentType, p.body),
  }));
}

export async function generateBatch(
  language: Language,
  contentType: ContentType,
): Promise<GenerateBatchResponse> {
  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [POST_TOOL],
      tool_choice: { type: "tool", name: POST_TOOL.name },
      messages: [{ role: "user", content: buildUserPrompt(language, contentType) }],
    });

    const raw = extractToolPosts(resp);
    return { posts: finalizePosts(raw, language, contentType) };
  } catch (e) {
    throw friendlyError(e);
  }
}

// ── Graphic batch ────────────────────────────────────────────────────
//
// Hand-built SVG-template lane: stat callouts, did-you-know cards,
// brand promo posters. Same Claude pipeline as photo posts but a
// different tool schema — Claude picks one of three templates per post
// and fills three short text fields rather than the photo-style
// headline + caption.

export const GRAPHIC_BATCH_POSTS = 6;

const GRAPHIC_TEMPLATES: GraphicTemplate[] = ["stat", "did_you_know", "promo"];

interface RawGraphicPost {
  angle: string;
  template: GraphicTemplate;
  headline: string;
  subline: string;
  body: string;
}

const GRAPHIC_TOOL = {
  name: "graphic_post_results",
  description:
    "Return the generated graphic-design social media posts. Call this exactly once with one entry per requested angle.",
  input_schema: {
    type: "object" as const,
    properties: {
      posts: {
        type: "array",
        description: "One entry per requested angle, in the same order.",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo back the angle key you were given." },
            template: {
              type: "string",
              enum: GRAPHIC_TEMPLATES,
              description:
                "Layout template. 'stat' = a big number/value with a one-line context (use when the angle has a quantitative anchor like 'top 10%' or '4.8 stars'). 'did_you_know' = mythbust or fact card with a hook + single explanation sentence. 'promo' = pure brand awareness with a tagline + sub-tagline.",
            },
            headline: {
              type: "string",
              description:
                "Display headline. For 'stat': the bare number/value (e.g., '4.8★', 'Top 10%', '$0 down'). For 'did_you_know': a short hook (e.g., 'USDA isn't just for farms.'). For 'promo': the brand tagline (e.g., 'Find an agent who fits.'). Max ~6 words.",
            },
            subline: {
              type: "string",
              description:
                "Single supporting line under the headline. Max ~14 words. For 'stat': what the number means (e.g., 'average rating across every Agent Match partner agent'). For 'did_you_know': a one-sentence elaboration. For 'promo': the value-prop tail (e.g., 'Vetted agents, matched to your situation, ready to help.').",
            },
            body: {
              type: "string",
              description:
                "3-5 sentence post body in the requested language for the IG caption. End with a newline and 3-5 hashtags. No URLs, no DM/CTA language, no em dashes. Treat this exactly like the photo-post body — same voice, same guardrails.",
            },
          },
          required: ["angle", "template", "headline", "subline", "body"],
        },
      },
    },
    required: ["posts"],
  },
};

function buildGraphicUserPrompt(language: Language, contentType: ContentType): string {
  const spec = CONTENT_TYPE_SPECS[contentType];
  const baseAngles = spec.angles;
  const angles =
    baseAngles.length === 0
      ? []
      : Array.from({ length: GRAPHIC_BATCH_POSTS }, (_, i) => baseAngles[i % baseAngles.length]);

  const angleList = angles
    .map(
      (a, i) =>
        `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}`,
    )
    .join("\n");

  const refDocSection = spec.referenceDocument
    ? `\n\nREFERENCE DOCUMENT (this is the source of truth for any specific claims; rephrase ideas naturally, do NOT copy verbatim, do NOT invent numbers or claims beyond what's here):\n${spec.referenceDocument}\n`
    : "";

  return `Language: ${LANGUAGE_LABELS[language]}
Topic: ${spec.topic}
Guardrails: ${spec.guardrails}${refDocSection}

These posts will render as DESIGNED GRAPHICS (not photos). Each post is a single 4:5 image with a designed layout — big headline, short subline, a CTA — no photography. The user picks one of three templates per post:

- "stat": a HUGE number / value as the headline, with a short context line. Pick this when the angle's brief lends itself to a quantitative anchor (top 10%, 4.8 stars, $0 down, etc.). Don't invent stats — only use what's in the reference document or the topic guardrails.
- "did_you_know": a mythbust / fact card. Headline is a short hook (often "Did you know?" or a punchy statement), subline is a single-sentence elaboration. Pick this for educational angles.
- "promo": pure brand awareness. Headline is the tagline, subline is the value-prop tail. Use sparingly — at most 1-2 of the ${GRAPHIC_BATCH_POSTS} posts. Don't repeat the same tagline across the batch.

Across the batch, mix templates so the user gets variety. Default to "stat" or "did_you_know" — promo is filler.

Produce one post for each of these angles, preserving the angle key:
${angleList}

Return your results by calling the graphic_post_results tool.`;
}

function extractGraphicToolPosts(resp: Anthropic.Messages.Message): RawGraphicPost[] {
  const tu = resp.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") {
    throw new Error("Claude did not call the graphic_post_results tool");
  }
  const input = tu.input as { posts?: RawGraphicPost[] };
  if (!input.posts || !Array.isArray(input.posts)) {
    throw new Error("graphic_post_results tool call missing 'posts' array");
  }
  return input.posts;
}

export async function generateGraphicBatch(
  language: Language,
  contentType: ContentType,
): Promise<GenerateBatchResponse> {
  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [GRAPHIC_TOOL],
      tool_choice: { type: "tool", name: GRAPHIC_TOOL.name },
      messages: [{ role: "user", content: buildGraphicUserPrompt(language, contentType) }],
    });

    const raw = extractGraphicToolPosts(resp);
    const posts = raw.map((p) => {
      const headline = stripDashes(p.headline).trim();
      const subline = stripDashes(p.subline).trim();
      return {
        angle: p.angle,
        // Top-band-style headline + cta echoed at the top level so any
        // existing UI that reads post.headline still has something to
        // show (card title, regen flows, etc.). The renderer reads
        // graphic.* for the actual SVG layout.
        headline,
        cta: CTA_TEXT[language],
        caption: buildCaption(language, contentType, p.body),
        graphic: {
          template: p.template,
          headline,
          subline,
          cta: CTA_TEXT[language],
        },
      };
    });
    return { posts };
  } catch (e) {
    throw friendlyError(e);
  }
}

export async function regenerateOne(
  language: Language,
  contentType: ContentType,
  angleKey: string,
): Promise<GenerateBatchResponse["posts"][number]> {
  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [POST_TOOL],
      tool_choice: { type: "tool", name: POST_TOOL.name },
      messages: [{ role: "user", content: buildUserPrompt(language, contentType, [angleKey]) }],
    });

    const raw = extractToolPosts(resp);
    if (raw.length === 0) throw new Error("Claude returned no post for angle " + angleKey);
    return finalizePosts(raw, language, contentType)[0];
  } catch (e) {
    throw friendlyError(e);
  }
}
