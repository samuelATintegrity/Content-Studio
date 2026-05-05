import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompts/system";
import { CONTENT_TYPE_SPECS, AI_POSTER_CONCEPTS } from "./prompts/content-types";
import { buildCaption, CTA_TEXT, stripDashes } from "./copy";
import {
  LANGUAGE_LABELS,
  type AiPosterGraphicData,
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
  // DYK draws from four educational pools so a single batch can mix
  // USDA, DPA, physician loans, and hero/first-responder programs
  // instead of going six-deep on USDA. buildAngleList round-robins
  // across these so you never get six of the same flavor.
  did_you_know: [
    "edu_zero_down_usda_local",
    "edu_dpa_local",
    "edu_physician_loans",
    "edu_hero_loans",
  ],
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

interface RawPromoPost {
  angle: string;
  headline: string;
  subline: string;
  body: string;
}

interface RawAiPosterPost {
  angle: string;
  conceptKey: string;
  imagePrompt: string;
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
                "STRICT FORMAT: digits only, max 4 characters. Examples: '10', '4.8', '73', '87', '$0', '25k'. NEVER include words like 'Top' or 'Only' here — those go in the statement. NEVER include the percent sign, star, or 'stars' here — those go in unit. Use ONLY documented values from the reference document. Never invent percentages, dollar amounts, or counts.",
            },
            unit: {
              type: "string",
              description:
                "Short suffix shown next to the number. Allowed: '%', '★', '+', 'k', 'M', 'x'. Use '★' (single character) when the stat is a star rating. Empty string when the number stands alone (e.g., a count like '10').",
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
                "QUICK-READ: ONE single sentence, MAX 14 words, MAX 80 characters. Punchy, scannable, mythbust energy. The eyebrow 'Did you know?' is rendered automatically — don't include it. NO compound sentences, NO clauses, NO 'and'-chains. Pick the single sharpest claim.",
            },
            body: {
              type: "string",
              description:
                "ONE short supporting sentence, MAX 22 words, MAX 130 characters. Adds the single most useful piece of practical context. NEVER multiple sentences. Same voice + guardrails as photo-static post copy.",
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

const PROMO_TOOL = {
  name: "promo_post_results",
  description:
    "Return one entry per requested angle for the Promo graphic template. Each post has a fresh on-image catchphrase headline + supporting line + IG caption body. The on-image copy is NOT fixed boilerplate — invent a different catchphrase per card so the batch feels varied.",
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
                "ON-IMAGE catchphrase, the giant rendered hook. 3-9 words, MAX 60 characters, MUST end with a period or question mark. Marketing energy, sharp and confident. Examples of TONE only (do not reuse): 'The right agent changes everything.', 'Most agents won't tell you this.', 'Stop hiring the first agent who calls.', 'Your home deserves a top 10% agent.'. Vary the construction across the 6 cards: declarative, second-person command, rhetorical question, contrarian. Each card MUST be a different catchphrase, no repeats.",
            },
            subline: {
              type: "string",
              description:
                "ON-IMAGE supporting sentence under the headline. ONE sentence, MAX 18 words, MAX 110 characters. Anchors the catchphrase back to a concrete value prop from the matching mission (top 10%, 4.8 stars, situation/price-range fit, pre-interviewed). Speaks directly to the buyer.",
            },
            body: {
              type: "string",
              description:
                "3-5 sentence IG caption body in the requested language, fitting the angle's brief. Newline + 3-5 hashtags at the end. No URLs, no DM/CTA language, no em dashes.",
            },
          },
          required: ["angle", "headline", "subline", "body"],
        },
      },
    },
    required: ["posts"],
  },
};

const AI_POSTER_TOOL = {
  name: "ai_poster_results",
  description:
    "Return one entry per requested concept for the AI-generated poster template. Each entry is a striking visual + branded copy combo. The image model renders only the bare visual (no text); the headline + subline are composited separately by our own typography pipeline, so write copy you'd be proud to set in a serious display weight.",
  input_schema: {
    type: "object" as const,
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            angle: { type: "string", description: "Echo the angle/concept key passed in the prompt." },
            conceptKey: {
              type: "string",
              description: "Echo the concept key passed in the prompt (e.g., 'apex_predator', 'sloth_slow').",
            },
            imagePrompt: {
              type: "string",
              description:
                "Fully-formed Nano Banana Pro prompt (60-180 words) describing the IMAGE ONLY — no text, no letters, no signs, no logos, no banners. Riff off the seed creatively: subject, framing, lighting, mood, color palette, photorealistic vs illustrated. Use specific, evocative language. The image model takes this verbatim. CRITICAL: do not include any words in quotes, no headlines, no UI elements, no tagline visible in the image. Pure visual only.",
            },
            headline: {
              type: "string",
              description:
                "ON-IMAGE catchphrase that pairs with the metaphor, MAX 5 words, MAX 35 characters. End with a period or question mark. Reinforces the angle the concept maps to (e.g., apex predator → 'Apex performers only.'; chameleon → 'Spot the pretender.'). Render-quality matters — we set this in Geist Black at 100+ pt.",
            },
            subline: {
              type: "string",
              description:
                "Single supporting sentence under the headline, MAX 10 words, MAX 70 characters. Bridges the metaphor back to the matching mission (top 10%, vetted, pre-interviewed, 4.8 stars). Plain English, no buzzwords.",
            },
            body: {
              type: "string",
              description:
                "3-5 sentence IG caption body in the requested language. Newline + 3-5 hashtags at the end. No URLs, no DM/CTA language, no em dashes.",
            },
          },
          required: ["angle", "conceptKey", "imagePrompt", "headline", "subline", "body"],
        },
      },
    },
    required: ["posts"],
  },
};

function buildAngleList(template: GraphicTemplate): string {
  const sourceTypes = TEMPLATE_CONTENT_TYPES[template];

  // For multi-pool templates (currently just DYK), round-robin across
  // pools and shuffle the per-pool order so the batch covers different
  // topics rather than going N-deep on the first pool. For single-pool
  // templates, keep the simple sequential pick.
  const pools = sourceTypes.map((ct) => {
    const angles = CONTENT_TYPE_SPECS[ct].angles.slice();
    // Fisher-Yates shuffle so we don't always lead with the same angle
    // from each pool; the batch feels different each time.
    for (let i = angles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [angles[i], angles[j]] = [angles[j], angles[i]];
    }
    return angles;
  });

  const seen = new Set<string>();
  const picked: { key: string; brief: string }[] = [];
  // Round-robin pool index so the batch interleaves: pool0[0], pool1[0],
  // pool2[0], pool3[0], pool0[1], pool1[1] for a 4-pool, 6-card batch.
  let exhausted = 0;
  const cursors = pools.map(() => 0);
  while (picked.length < GRAPHIC_BATCH_POSTS && exhausted < pools.length) {
    exhausted = 0;
    for (let p = 0; p < pools.length && picked.length < GRAPHIC_BATCH_POSTS; p++) {
      const pool = pools[p];
      while (cursors[p] < pool.length && seen.has(pool[cursors[p]].key)) cursors[p]++;
      if (cursors[p] >= pool.length) {
        exhausted++;
        continue;
      }
      const a = pool[cursors[p]++];
      seen.add(a.key);
      picked.push({ key: a.key, brief: a.brief });
    }
  }
  return picked.map((a, i) => `${i + 1}. angle="${a.key}"\n   brief: ${a.brief}`).join("\n");
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
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p, i) => {
      const graphic: StatGraphicData = {
        template: "stat",
        number: stripDashes(p.number).trim(),
        unit: stripDashes(p.unit ?? "").trim(),
        statement: stripDashes(p.statement).trim(),
        source: stripDashes(p.source).trim(),
        index: String(i + 1).padStart(2, "0"),
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

This batch generates ${GRAPHIC_BATCH_POSTS} Did-You-Know graphic posts. Each card is a QUICK-READ fact: a punchy single-sentence hook (≤14 words) and a single supporting sentence (≤22 words). Treat every word as expensive — these are scrolled-past posts, not articles. Cover a varied mix of topics across the batch (USDA, DPA, physician loans, hero/community programs) — each angle below comes from a different pool, do not collapse them into the same topic. The eyebrow "Did you know?" is rendered automatically by the template — don't include it in the fact text.

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
  // Promo on-image copy is now fully dynamic — Claude invents a fresh
  // catchphrase headline + supporting line per card. Each post in the
  // batch should feel like a different ad pulled from the same brand
  // family, not 6 identical copies of the brand tagline.
  const captionContentType = captionContentTypeFor("promo");
  const prompt = `${buildBaseHeader(language, "promo")}

This batch generates ${GRAPHIC_BATCH_POSTS} Promo posts. Each post is a brand catchphrase ad: a giant on-image headline (3-9 words, MAX 60 characters, ends with . or ?), a single supporting sentence under it (≤18 words), and an IG caption body. Treat the 6 cards as a varied campaign — different constructions, different hooks, no two cards saying the same thing. Lean on classic Agent Match angles where useful (top 10%, 4.8 stars, situation/price-range fit, pre-interviewed) but the hook should feel like ad copy, not a feature list. AVOID 'tens of thousands' phrasing — that's been overused; reach for fresh constructions.

Angles:
${buildAngleList("promo")}

Return your results by calling the ${PROMO_TOOL.name} tool.`;

  try {
    const raw = await callTool<RawPromoPost>(prompt, PROMO_TOOL);
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p) => {
      const headline = stripDashes(p.headline).trim();
      const subline = stripDashes(p.subline).trim();
      return {
        angle: p.angle,
        headline,
        cta: CTA_TEXT[language],
        caption: buildCaption(language, captionContentType, p.body),
        graphic: { template: "promo", headline, subline },
      };
    });
    return { posts };
  } catch (e) {
    throw friendlyError(e);
  }
}

// Available good_agents angles the AI poster can target — Claude
// invents the metaphor and picks which value-prop angle the metaphor
// argues for. Keep this list short and mission-flavored; the stat_*
// angles are reserved for the stat template.
const AI_POSTER_TARGET_ANGLES = [
  "top_performers",
  "proven_reviews",
  "pre_interviewed",
  "filters_part_time",
  "why_quality_matters",
  "situation_goals",
  "price_match",
  "buy_sell_focus",
] as const;

async function generateAiPosterBatch(language: Language): Promise<GenerateBatchResponse> {
  const captionContentType = captionContentTypeFor("ai_poster");

  // Show the full seed library as a vibe reference. Claude is told
  // to use 2-3 of these as direct inspiration AND invent 3-4 brand-new
  // metaphors so each batch stretches the visual range. Per the user
  // (2026-05-04): "we're not limited to 8 types".
  const seedLibrary = AI_POSTER_CONCEPTS.map(
    (c, i) =>
      `${i + 1}. ${c.key} (mapsTo=${c.mapsTo}, tone=${c.tone})\n   visual: ${c.seed}`,
  ).join("\n");
  const angleList = AI_POSTER_TARGET_ANGLES.map((a) => `  - ${a}`).join("\n");

  const prompt = `${buildBaseHeader(language, "ai_poster")}

This batch generates ${GRAPHIC_BATCH_POSTS} AI-poster cards. Each card pairs a striking, scroll-stopping AI-generated image with a sharp branded tagline. The IMAGE and the TEXT are produced separately — the image model gets ONLY a visual prompt (no words to render), and we composite the headline + subline ourselves with our own typography.

Hard rules:
- imagePrompt MUST describe pure visuals. NEVER quote text the model should "render", NEVER mention signs/banners/billboards/UI/captions/labels/typography/storefronts/license-plates. The composited image will have NO readable text besides what we add later.
- The headline + subline are set in Geist Black at large display weight, so they can be properly typeset — write copy you'd be proud to set in a serious font. Aim for sharp, declarative, scroll-stopping ad copy that pairs with the metaphor.
- Each card in the batch should feel like a different ad in the same campaign — vary subject category (animals / landscape / surreal scene / object), framing, lighting, and tone across the 6 cards.
- Every metaphor must clearly argue for ONE of the brand value props (an angle from the list below).

How to compose the batch:
- Use 2-3 of the seed metaphors below as direct inspiration. You can rephrase the seed prompt; do NOT copy it verbatim.
- INVENT 3-4 brand-new metaphors that fit the same vibe but aren't on the list. The bar: striking, unusual, instantly metaphorical, photographable. (Examples of fresh territory: an iceberg with most of its mass underwater for 'most of an agent's value is invisible'; a single matchstick lit in a dark stadium for 'one right agent in a market of thousands'; a chef's knife next to a butter knife for 'the right tool matters'; rotten apple in a perfect bushel for 'one bad apple kills the deal'. These are illustrative — your inventions should be different from these AND from the seeds.)

Seed library (use 2-3 as inspiration, invent the rest):
${seedLibrary}

Available value-prop angles (each card MUST tie its metaphor to one of these — pick the best fit for your metaphor):
${angleList}

For each card, write:
- conceptKey: a short snake_case label for your metaphor (e.g., 'iceberg_hidden_mass', 'matchstick_in_stadium'). Use the exact seed key when reusing a seed.
- angle: the angle this metaphor argues for, from the list above.
- imagePrompt: 60-180 words describing the bare visual (subject, framing, lighting, mood, palette, photoreal vs illustrated, atmosphere). NO TEXT ANYWHERE IN THE IMAGE.
- headline: ≤5 words ending in . or ?
- subline: ≤10 words supporting the headline + linking to the matching mission (top 10%, vetted, pre-interviewed, 4.8 stars, situation/price-fit).
- body: 3-5 sentence IG caption tying the metaphor back to the angle.

Return your results by calling the ${AI_POSTER_TOOL.name} tool — exactly ${GRAPHIC_BATCH_POSTS} entries.`;

  try {
    const raw = await callTool<RawAiPosterPost>(prompt, AI_POSTER_TOOL);
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p) => {
      const headline = stripDashes(p.headline).trim();
      const subline = stripDashes(p.subline).trim();
      const imagePrompt = stripDashes(p.imagePrompt).trim();
      const graphic: AiPosterGraphicData = {
        template: "ai_poster",
        headline,
        subline,
        imagePrompt,
        conceptKey: p.conceptKey,
      };
      return {
        angle: p.angle,
        headline,
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
