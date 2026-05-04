import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompts/system";
import { CONTENT_TYPE_SPECS } from "./prompts/content-types";
import { buildCaption, CTA_TEXT, stripDashes } from "./copy";
import {
  LANGUAGE_LABELS,
  type ContentType,
  type DykGraphicData,
  type GenerateBatchResponse,
  type GraphicData,
  type GraphicTemplate,
  type Language,
  type StatGraphicData,
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
// One generator per template. Each has its own tool schema for the
// fields the template actually displays. The user has already picked
// the template at the UI level (selectedGraphicTemplate in the store);
// we don't ask Claude to pick. Promo's on-image copy is fixed brand
// boilerplate so Claude only writes the IG caption body for that one.

export const GRAPHIC_BATCH_POSTS = 6;

// Each template draws angles from the content-type pool that fits its
// tone. Stat + Promo lean on the matching-mission angles (top 10%, 4.8
// stars, vetted) — those are the only documented quantitative anchors
// for stat callouts and the brand-mission angles for promo. Did-you-know
// pulls from the educational pools (USDA + DPA) since they have the
// mythbust briefs the format leans on.
const TEMPLATE_CONTENT_TYPES: Record<GraphicTemplate, ContentType[]> = {
  stat: ["good_agents"],
  did_you_know: ["edu_zero_down_usda_local", "edu_dpa_local"],
  promo: ["good_agents"],
  ai_poster: ["good_agents"],
};

interface RawStatPost {
  angle: string;
  number: string;
  unit: string;
  statement: string;
  source: string;
  body: string;
}

interface RawDykPost {
  angle: string;
  fact: string;
  body: string;
  caption_body: string;
}

interface RawCaptionOnlyPost {
  angle: string;
  body: string;
}

interface RawAiPosterPost {
  angle: string;
  headline: string;
  subline: string;
  body: string;
}

const STAT_TOOL = {
  name: "stat_post_results",
  description: "Return one entry per requested angle for the Statistic graphic template.",
  input_schema: {
    type: "object" as const,
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo the angle key." },
            number: {
              type: "string",
              description:
                "The bare numeric anchor that will be rendered HUGE (e.g., '10', '4.8', '$0'). Use ONLY documented values — top 10% and 4.8 stars or higher are explicitly allowed. Never invent percentages, dollar amounts, or counts. Keep it short, just the number itself, no descriptive text.",
            },
            unit: {
              type: "string",
              description:
                "The smaller suffix shown next to the number ('%', '★', ' down', '+'). Empty string is fine if the number stands alone.",
            },
            statement: {
              type: "string",
              description:
                "Single supporting sentence (max ~14 words) that gives the number meaning. Same voice + guardrails as photo-static post copy.",
            },
            source: {
              type: "string",
              description:
                "Short attribution line, mono-styled in the render (e.g., 'Industry data, 2024'). Keep it generic — never invent a publication that doesn't exist.",
            },
            body: {
              type: "string",
              description:
                "3-5 sentence IG caption body in the requested language. Newline + 3-5 hashtags at the end. No URLs, no DM/CTA language, no em dashes.",
            },
          },
          required: ["angle", "number", "unit", "statement", "source", "body"],
        },
      },
    },
    required: ["posts"],
  },
};

const DYK_TOOL = {
  name: "dyk_post_results",
  description: "Return one entry per requested angle for the Did-You-Know graphic template.",
  input_schema: {
    type: "object" as const,
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo the angle key." },
            fact: {
              type: "string",
              description:
                "1-2 sentence headline statement, the rendered hook. Punchy and educational, mythbust energy. The eyebrow 'Did you know?' is rendered automatically by the template — don't include it here.",
            },
            body: {
              type: "string",
              description:
                "1-2 sentence supporting paragraph (rendered below the fact). Elaborates the fact with practical context. Same voice + guardrails as photo-static post copy.",
            },
            caption_body: {
              type: "string",
              description:
                "3-5 sentence IG caption body in the requested language. Newline + 3-5 hashtags at the end. No URLs, no DM/CTA language, no em dashes.",
            },
          },
          required: ["angle", "fact", "body", "caption_body"],
        },
      },
    },
    required: ["posts"],
  },
};

const CAPTION_ONLY_TOOL = {
  name: "caption_only_results",
  description: "Return one IG caption body per requested angle. The image copy is fixed at the template level.",
  input_schema: {
    type: "object" as const,
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo the angle key." },
            body: {
              type: "string",
              description:
                "3-5 sentence IG caption body in the requested language, fitting the angle's brief. Newline + 3-5 hashtags at the end. No URLs, no DM/CTA language, no em dashes.",
            },
          },
          required: ["angle", "body"],
        },
      },
    },
    required: ["posts"],
  },
};

const AI_POSTER_TOOL = {
  name: "ai_poster_results",
  description: "Return one entry per requested angle for the AI-generated poster template.",
  input_schema: {
    type: "object" as const,
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo the angle key." },
            headline: {
              type: "string",
              description:
                "Short tagline (≤6 words). The image model sets it as a large display headline. Don't use specific numbers, dollar amounts, or percentages — image-model typography is unreliable on long or numeric text.",
            },
            subline: {
              type: "string",
              description: "Single supporting line (≤12 words).",
            },
            body: {
              type: "string",
              description:
                "3-5 sentence IG caption body in the requested language. Newline + 3-5 hashtags at the end. No URLs, no DM/CTA language, no em dashes.",
            },
          },
          required: ["angle", "headline", "subline", "body"],
        },
      },
    },
    required: ["posts"],
  },
};

function buildAngleList(template: GraphicTemplate): string {
  const sourceTypes = TEMPLATE_CONTENT_TYPES[template];
  const seen = new Set<string>();
  const flat: { key: string; brief: string }[] = [];
  for (const ct of sourceTypes) {
    for (const a of CONTENT_TYPE_SPECS[ct].angles) {
      if (seen.has(a.key)) continue;
      seen.add(a.key);
      flat.push({ key: a.key, brief: a.brief });
    }
  }
  const angles =
    flat.length === 0
      ? []
      : Array.from({ length: GRAPHIC_BATCH_POSTS }, (_, i) => flat[i % flat.length]);
  return angles.map((a, i) => `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}`).join("\n");
}

function buildRefDocSection(template: GraphicTemplate): string {
  const sourceTypes = TEMPLATE_CONTENT_TYPES[template];
  const refDocs = sourceTypes
    .map((ct) => CONTENT_TYPE_SPECS[ct].referenceDocument)
    .filter((d): d is string => Boolean(d));
  if (!refDocs.length) return "";
  return `\n\nREFERENCE DOCUMENT(S) (source of truth for any specific claims; rephrase ideas naturally, do NOT copy verbatim, do NOT invent numbers or claims beyond what's here):\n${refDocs.join("\n\n---\n\n")}\n`;
}

function buildBaseHeader(language: Language, template: GraphicTemplate): string {
  const sourceTypes = TEMPLATE_CONTENT_TYPES[template];
  const topicLine = sourceTypes.map((ct) => CONTENT_TYPE_SPECS[ct].topic).join(" + ");
  const guardrailLine = sourceTypes.map((ct) => CONTENT_TYPE_SPECS[ct].guardrails).join(" Also: ");
  return `Language: ${LANGUAGE_LABELS[language]}\nTopic: ${topicLine}\nGuardrails: ${guardrailLine}${buildRefDocSection(template)}`;
}

function extractToolPostsTyped<T>(resp: Anthropic.Messages.Message, toolName: string): T[] {
  const tu = resp.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") {
    throw new Error(`Claude did not call the ${toolName} tool`);
  }
  const input = tu.input as { posts?: T[] };
  if (!input.posts || !Array.isArray(input.posts)) {
    throw new Error(`${toolName} tool call missing 'posts' array`);
  }
  return input.posts;
}

// Loose tool typing — each per-template tool has a different
// input_schema shape, so we widen the parameter type and rely on the
// runtime to validate.
type GraphicTool = { name: string; description: string; input_schema: Record<string, unknown> };

async function callTool<T>(prompt: string, tool: GraphicTool): Promise<T[]> {
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    tools: [tool as unknown as Anthropic.Messages.ToolUnion],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: prompt }],
  });
  return extractToolPostsTyped<T>(resp, tool.name);
}

function captionContentTypeFor(template: GraphicTemplate): ContentType {
  return TEMPLATE_CONTENT_TYPES[template][0];
}

async function generateStatBatch(language: Language): Promise<GenerateBatchResponse> {
  const captionContentType = captionContentTypeFor("stat");
  const prompt = `${buildBaseHeader(language, "stat")}

This batch generates ${GRAPHIC_BATCH_POSTS} Statistic graphic posts. Each post displays a HUGE numeric value as the headline (e.g., 10%, 4.8★) with a one-line statement underneath, plus an attribution source line. Stat callout typography rewards short, punchy values.

Produce one post per angle. Across the batch, vary which numeric anchor you pick — don't repeat "Top 10%" or "4.8 stars" 6 times. Mix in other documented angles (vetted agents, pre-interviewed, buy-side specialists) by extracting their natural numeric framing where possible.

Angles:
${buildAngleList("stat")}

Return your results by calling the ${STAT_TOOL.name} tool.`;

  try {
    const raw = await callTool<RawStatPost>(prompt, STAT_TOOL);
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p) => {
      const graphic: StatGraphicData = {
        template: "stat",
        number: stripDashes(p.number).trim(),
        unit: stripDashes(p.unit ?? "").trim(),
        statement: stripDashes(p.statement).trim(),
        source: stripDashes(p.source).trim(),
      };
      return {
        angle: p.angle,
        // Mirror the headline/cta pair into the top-level Post fields
        // so any UI that reads them (card title, regen) has copy.
        headline: graphic.number + (graphic.unit ? graphic.unit : ""),
        cta: CTA_TEXT[language],
        caption: buildCaption(language, captionContentType, p.body),
        graphic,
      };
    });
    return { posts };
  } catch (e) {
    throw friendlyError(e);
  }
}

async function generateDykBatch(language: Language): Promise<GenerateBatchResponse> {
  const captionContentType = captionContentTypeFor("did_you_know");
  const prompt = `${buildBaseHeader(language, "did_you_know")}

This batch generates ${GRAPHIC_BATCH_POSTS} Did-You-Know graphic posts. Each post is a fact card: an opening hook fact (1-2 sentences) and a supporting elaboration (1-2 sentences). The eyebrow "Did you know?" is rendered automatically by the template — don't include it in the fact text.

Angles:
${buildAngleList("did_you_know")}

Return your results by calling the ${DYK_TOOL.name} tool.`;

  try {
    const raw = await callTool<RawDykPost>(prompt, DYK_TOOL);
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p, i) => {
      const graphic: DykGraphicData = {
        template: "did_you_know",
        fact: stripDashes(p.fact).trim(),
        body: stripDashes(p.body).trim(),
        index: String(i + 1).padStart(2, "0"),
      };
      return {
        angle: p.angle,
        headline: graphic.fact,
        cta: CTA_TEXT[language],
        caption: buildCaption(language, captionContentType, p.caption_body),
        graphic,
      };
    });
    return { posts };
  } catch (e) {
    throw friendlyError(e);
  }
}

async function generatePromoBatch(language: Language): Promise<GenerateBatchResponse> {
  // Promo on-image copy is fixed brand boilerplate. Claude only writes
  // distinct IG caption bodies per angle so the same visual posts have
  // varied accompanying captions instead of being literally identical.
  const captionContentType = captionContentTypeFor("promo");
  const prompt = `${buildBaseHeader(language, "promo")}

This batch generates ${GRAPHIC_BATCH_POSTS} Promo posts. The on-image copy is FIXED brand boilerplate (the canonical Agent Match tagline + value prop), so don't write it. Your only job is the IG caption body — one caption per angle, varied across the batch so the same visual post has different supporting copy each time.

Angles:
${buildAngleList("promo")}

Return your results by calling the ${CAPTION_ONLY_TOOL.name} tool.`;

  try {
    const raw = await callTool<RawCaptionOnlyPost>(prompt, CAPTION_ONLY_TOOL);
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p) => ({
      angle: p.angle,
      headline: "The wrong agent can cost you tens of thousands.",
      cta: CTA_TEXT[language],
      caption: buildCaption(language, captionContentType, p.body),
      graphic: { template: "promo" },
    }));
    return { posts };
  } catch (e) {
    throw friendlyError(e);
  }
}

async function generateAiPosterBatch(language: Language): Promise<GenerateBatchResponse> {
  const captionContentType = captionContentTypeFor("ai_poster");
  const prompt = `${buildBaseHeader(language, "ai_poster")}

This batch generates ${GRAPHIC_BATCH_POSTS} AI-generated posters. The image model (Nano Banana Pro) renders typography from the headline + subline, so keep both VERY short — long or numeric text comes back garbled. No specific numbers, dollar amounts, or percentages.

Angles:
${buildAngleList("ai_poster")}

Return your results by calling the ${AI_POSTER_TOOL.name} tool.`;

  try {
    const raw = await callTool<RawAiPosterPost>(prompt, AI_POSTER_TOOL);
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p) => {
      const headline = stripDashes(p.headline).trim();
      const subline = stripDashes(p.subline).trim();
      return {
        angle: p.angle,
        headline,
        cta: CTA_TEXT[language],
        caption: buildCaption(language, captionContentType, p.body),
        graphic: { template: "ai_poster", headline, subline },
      };
    });
    return { posts };
  } catch (e) {
    throw friendlyError(e);
  }
}

export async function generateGraphicBatch(
  language: Language,
  template: GraphicTemplate,
): Promise<GenerateBatchResponse> {
  switch (template) {
    case "stat":          return generateStatBatch(language);
    case "did_you_know":  return generateDykBatch(language);
    case "promo":         return generatePromoBatch(language);
    case "ai_poster":     return generateAiPosterBatch(language);
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
