import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompts/system";
import { CONTENT_TYPE_SPECS, AI_POSTER_THEMES } from "./prompts/content-types";
import { FUNNY_COMMERCIAL_THEMES } from "./prompts/funny-commercial-themes";
import { buildCaption, CTA_TEXT, stripDashes } from "./copy";
import {
  getRecentGeneratedConcepts,
  getRecentScheduledConcepts,
  recordGeneratedConcepts,
} from "./scheduledConcepts";
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
  // Where the headline + cta will be composited on the photo. Drives
  // both the AI photo composition guidance (subject placed in the
  // opposite zone, calm negative space in textZone) and the Vision-
  // placement default at render time.
  textZone: "top" | "bottom";
}

const POST_TOOL = {
  name: "post_results",
  description: "Return the generated social media posts. Call this exactly once with one entry per requested angle. The image is generated separately; you decide upfront where the typography will sit on each card and the photo prompt will be tuned to leave that zone calm.",
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
            textZone: {
              type: "string",
              enum: ["top", "bottom"],
              description: "Where the headline + cta will land on this card. Pick whichever zone feels right for the angle (e.g., a hopeful angle leans top; a stakes-heavy angle leans bottom). Vary across the batch — aim for a roughly even mix so the 12-card strip feels visually different at a glance.",
            },
            headline: { type: "string", description: "On-image headline. HARD LIMITS: max 4 words AND max 32 characters total. Sharp, declarative, no emojis. We render this in Geist Black at large display weight grouped with the cta in your chosen textZone." },
            body: { type: "string", description: "3-5 sentence post body in the requested language. End with a newline and 3-5 hashtags. No URLs, no DM/CTA language, no em dashes." },
          },
          required: ["angle", "textZone", "headline", "body"],
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

ALSO PICK textZone for each post — 'top' or 'bottom'. This is where the headline + cta will be composited on the photo, and it drives how we generate the AI image (subject placed in the OPPOSITE zone so the typography lands on calm pixels). Pick whichever zone fits the angle's tone — hopeful or aspirational angles tend to read well at top; stakes-heavy or contrarian angles at bottom. CRITICAL: vary across the batch — aim for a roughly even mix of top and bottom across the ${STATIC_BATCH_POSTS} posts so the rendered strip feels visually different at a glance. Do not pick all top or all bottom.

Return your results by calling the post_results tool.`;
}

function extractToolPosts(resp: Anthropic.Messages.Message): RawPost[] {
  const tu = resp.content.find((b) => b.type === "tool_use");
  if (!tu || tu.type !== "tool_use") {
    throw new Error(
      `Claude did not call the post_results tool (stop_reason=${resp.stop_reason})`,
    );
  }
  const input = tu.input as { posts?: RawPost[] };
  if (!input.posts || !Array.isArray(input.posts)) {
    throw new Error(
      `post_results tool call missing 'posts' array (stop_reason=${resp.stop_reason}; bump max_tokens if 'max_tokens')`,
    );
  }
  return input.posts;
}

function finalizePosts(raw: RawPost[], language: Language, contentType: ContentType) {
  return raw.map((p) => ({
    angle: p.angle,
    headline: stripDashes(p.headline).trim(),
    cta: CTA_TEXT[language],
    caption: buildCaption(language, contentType, p.body),
    contentType,
    // Default to "bottom" if Claude omits the field for any reason —
    // bottom-fade + halo is the most universally legible placement.
    textZone: (p.textZone === "top" ? "top" : "bottom") as "top" | "bottom",
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

// Photo-blend batch: when the static UI's "Photo" pill is picked, we
// don't ask the user to drill into a single content type. Instead we
// fan out 4 parallel calls to generateBatch (one per topical content
// type), take the first 3 posts from each (canonically angles 1-3 of
// that pool), and interleave them so the 12-card output reads as
// [ct1[0], ct2[0], ct3[0], ct4[0], ct1[1], ct2[1], ...] — every fourth
// card is the same topic, so the strip feels varied as the user
// scrolls.
//
// language_match is intentionally NOT in the blend; the audience for
// English skips it entirely, and for non-English languages the user
// can still get language_match content via the (older) single-content
// path if we ever bring it back. For now the brand is pushing the
// four core topical pools.
const PHOTO_BLEND_CONTENT_TYPES: ContentType[] = [
  "zero_down_generic",
  "edu_zero_down_usda_local",
  "edu_dpa_local",
  "good_agents",
];
const PHOTO_BLEND_PER_POOL = 3;

export async function generatePhotoBlendBatch(
  language: Language,
): Promise<GenerateBatchResponse> {
  const subBatches = await Promise.all(
    PHOTO_BLEND_CONTENT_TYPES.map((ct) => generateBatch(language, ct)),
  );

  // Take first PHOTO_BLEND_PER_POOL from each sub-batch and interleave
  // by position. Each sub-batch already has each post tagged with its
  // contentType via finalizePosts.
  const interleaved: GenerateBatchResponse["posts"] = [];
  for (let i = 0; i < PHOTO_BLEND_PER_POOL; i++) {
    for (const sub of subBatches) {
      const post = sub.posts[i];
      if (post) interleaved.push(post);
    }
  }
  return { posts: interleaved };
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
  textZone: "top" | "bottom";
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
    "Return one entry per requested concept for the AI-generated poster template. Each entry is a striking visual + branded copy combo. The image model renders only the bare visual (no text); the headline + subline are composited separately by our own typography pipeline. Decide upfront where the text will land on each card and write the imagePrompt to leave that zone calm.",
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
            textZone: {
              type: "string",
              enum: ["top", "bottom"],
              description:
                "Where the headline + subline will be composited on this card. CRITICAL: this drives how you write the imagePrompt. Pick whichever zone leaves the most room for the metaphor's natural composition. Vary across the batch — don't pick all top or all bottom; aim for a roughly even split so layouts feel different across the 6 cards.",
            },
            imagePrompt: {
              type: "string",
              description:
                "Fully-formed Nano Banana Pro prompt (60-180 words) describing the IMAGE ONLY — no text, no letters, no signs, no logos, no banners. The composition MUST honor the textZone you picked: place the focal subject in the OPPOSITE zone, and explicitly leave the textZone as calm atmospheric negative space (e.g., for textZone=bottom: 'subject in the upper two-thirds, the lower third fading to dark void / soft gradient / out-of-focus blur — pure calm space for typography'; for textZone=top: 'subject in the lower two-thirds, the upper third opens to soft sky / atmospheric haze / minimal backdrop'). Be specific about subject framing, lighting, mood, palette, photoreal vs illustrated. CRITICAL: do not include any words in quotes, no headlines, no UI elements, no tagline visible in the image. Pure visual only.",
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
          required: ["angle", "conceptKey", "textZone", "imagePrompt", "headline", "subline", "body"],
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
    throw new Error(
      `Claude did not call the ${toolName} tool (stop_reason=${resp.stop_reason})`,
    );
  }
  const input = tu.input as { posts?: T[] };
  if (!input.posts || !Array.isArray(input.posts)) {
    // Almost always means the response was truncated mid-tool-call by
    // max_tokens. Surface stop_reason so the operator knows whether to
    // raise the cap or to look at a malformed tool schema.
    throw new Error(
      `${toolName} tool call missing 'posts' array (stop_reason=${resp.stop_reason}; bump max_tokens if 'max_tokens')`,
    );
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
    // 8192 — the DYK prompt now spans 4 angle pools + tighter field
    // descriptions, and the AI poster tool call carries a 60-180-word
    // imagePrompt per card. 4096 was clipping mid-call on long batches.
    max_tokens: 8192,
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

  // Theme library: each theme conveys a message and offers many
  // visual realizations. Claude picks DIFFERENT themes for the batch
  // (one card per theme) and picks a visual within each theme — that's
  // where the rotation comes from. Showing all visuals upfront lets
  // Claude pick a fresh one each batch instead of always reaching for
  // the first/easiest seed (which is what was shipping the same
  // tiger / chameleon / scalpel three batches in a row).
  const themeLibrary = AI_POSTER_THEMES.map((t, i) => {
    const visuals = t.visuals
      .map((v) => `      - ${t.key}:${v.key} → ${v.seed}`)
      .join("\n");
    return `${i + 1}. THEME ${t.key}  (mapsTo=${t.mapsTo}, tone=${t.tone})
   message: ${t.message}
   visual options:
${visuals}`;
  }).join("\n\n");
  const angleList = AI_POSTER_TARGET_ANGLES.map((a) => `  - ${a}`).join("\n");

  // Two cooldowns:
  //   - SCHEDULED (14 days): the user actually queued these to Buffer.
  //     Strong signal — avoid the conceptKey AND visually-similar
  //     metaphors.
  //   - GENERATED (5 days): we already showed these in a recent batch.
  //     Softer signal — just don't repeat the same conceptKey, and
  //     prefer untouched themes when possible.
  // Both reads are best-effort; tracker failures never block the batch.
  const [recentlyScheduled, recentlyGenerated] = await Promise.all([
    getRecentScheduledConcepts(14).catch(() => []),
    getRecentGeneratedConcepts(5).catch(() => []),
  ]);

  // Compute which themes have shown up recently (any visual under a
  // theme counts as the theme being "warm"). Helps Claude prefer
  // dormant themes for the next batch.
  const recentlyUsedThemeKeys = new Set<string>();
  for (const k of recentlyGenerated) {
    const themeKey = k.includes(":") ? k.split(":")[0] : k;
    recentlyUsedThemeKeys.add(themeKey);
  }
  const dormantThemes = AI_POSTER_THEMES.map((t) => t.key).filter(
    (k) => !recentlyUsedThemeKeys.has(k),
  );

  const scheduledBlock =
    recentlyScheduled.length > 0
      ? `\n\nSCHEDULED COOLDOWN — DO NOT REPEAT (the user already queued these to Buffer in the last 14 days):
${recentlyScheduled.map((k) => `  - ${k}`).join("\n")}
Skip these conceptKeys exactly AND avoid visually-similar realizations within the same theme.`
      : "";

  const generatedBlock =
    recentlyGenerated.length > 0
      ? `\n\nRECENTLY SHOWN — pick something else (these appeared in batches over the last 5 days):
${recentlyGenerated.map((k) => `  - ${k}`).join("\n")}
For each theme, prefer a visual option you have NOT used recently. ${
          dormantThemes.length > 0
            ? `Themes the user hasn't seen lately: ${dormantThemes.join(", ")} — favor these.`
            : ""
        }`
      : "";

  const prompt = `${buildBaseHeader(language, "ai_poster")}

This batch generates ${GRAPHIC_BATCH_POSTS} AI-poster cards. Each card pairs a striking, scroll-stopping AI-generated image with a sharp branded tagline. The IMAGE and the TEXT are produced separately — the image model gets ONLY a visual prompt (no words to render), and we composite the headline + subline ourselves with our own typography.

Hard rules:
- imagePrompt MUST describe pure visuals. NEVER quote text the model should "render", NEVER mention signs/banners/billboards/UI/captions/labels/typography/storefronts/license-plates. The composited image will have NO readable text besides what we add later.
- The headline + subline are set in Geist Black at large display weight, so they can be properly typeset — write copy you'd be proud to set in a serious font. Aim for sharp, declarative, scroll-stopping ad copy that pairs with the metaphor.
- Each card in the batch should feel like a different ad in the same campaign — vary subject category (animals / landscape / surreal scene / object), framing, lighting, and tone across the 6 cards.
- Every metaphor must clearly argue for ONE of the brand value props (an angle from the list below).

HOW TO PICK YOUR ${GRAPHIC_BATCH_POSTS} CARDS (most important):
- The theme library below is grouped by MESSAGE. Each theme has many visual realizations.
- Step 1: pick ${GRAPHIC_BATCH_POSTS} DIFFERENT THEMES from the library. Never use the same theme twice in a single batch — the whole point of themes is to give the batch range.
- Step 2: within each chosen theme, pick ONE visual option. Pick the one that fits the moment — variety across batches is the goal, so don't always pick the first option in the list. If a visual feels worn out, pick a different one within the same theme.
- Step 3 (optional, only if you want to push the batch further): you may invent ONE fresh visual within an existing theme if none of the listed options feel right — but it must clearly fit that theme's message. Use a conceptKey of \`<themeKey>:<your_new_visual_key>\` so it's tracked correctly. Do NOT invent new themes.

COMPOSE WITH INTENT (also important):
- For each card, FIRST decide where the headline + subline will land — top of the frame OR bottom of the frame. This is the textZone field.
- Then write the imagePrompt to honor that decision: place the FOCAL SUBJECT in the OPPOSITE zone (the bottom two-thirds if textZone=top; the upper two-thirds if textZone=bottom), and explicitly leave the textZone as CALM ATMOSPHERIC NEGATIVE SPACE — out-of-focus blur, soft gradient, atmospheric haze, dark void, cloud cover, or solid color. The text must have somewhere clean to land.
- Examples of explicit composition language to include in imagePrompt: "subject anchored in lower two-thirds, upper third opens to soft hazy sky for typography"; "tight macro of the subject filling the upper portion, lower third fades to deep black void"; "subject left-of-center in bottom half, top half is empty atmospheric backdrop". Be this specific.
- Vary textZone across the 6 cards — aim for roughly 3 top + 3 bottom so layouts feel different at a glance.
- Some metaphors naturally suit one zone: extreme close-ups of eyes/faces tend to work top (subject in upper half, calm bottom). Standing/centered subjects work bottom (subject anchored in upper, calm bottom). Pick what suits the metaphor.

THEME LIBRARY (pick ${GRAPHIC_BATCH_POSTS} different themes; one visual per theme):
${themeLibrary}

Available value-prop angles (each card's angle MUST come from the chosen theme's mapsTo, OR a closely related angle from this list):
${angleList}${scheduledBlock}${generatedBlock}

For each card, write:
- conceptKey: \`<themeKey>:<visualKey>\` exactly as shown in the library (e.g., 'the_best:tiger_macro', 'pretenders:chameleon_suit'). If you invent a fresh visual within a theme, use the form '<themeKey>:<your_new_visual_key>'.
- angle: the angle this card argues for. Default to the theme's mapsTo, but you may pick a related one from the angles list if your copy genuinely speaks to it.
- textZone: 'top' or 'bottom' — where the headline + subline will live on this card.
- imagePrompt: 60-180 words describing the bare visual, WITH explicit composition guidance that honors textZone (subject in opposite zone, calm negative space in textZone). NO TEXT ANYWHERE IN THE IMAGE. You may rephrase / extend the seed; do NOT copy it verbatim.
- headline: ≤5 words ending in . or ?
- subline: ≤10 words supporting the headline + linking to the matching mission (top 10%, vetted, pre-interviewed, 4.8 stars, situation/price-fit).
- body: 3-5 sentence IG caption tying the metaphor back to the angle.

Return your results by calling the ${AI_POSTER_TOOL.name} tool — exactly ${GRAPHIC_BATCH_POSTS} entries, ${GRAPHIC_BATCH_POSTS} distinct themes.`;

  try {
    const raw = await callTool<RawAiPosterPost>(prompt, AI_POSTER_TOOL);
    const posts = raw.map<GenerateBatchResponse["posts"][number]>((p) => {
      const headline = stripDashes(p.headline).trim();
      const subline = stripDashes(p.subline).trim();
      const imagePrompt = stripDashes(p.imagePrompt).trim();
      const textZone: "top" | "bottom" = p.textZone === "top" ? "top" : "bottom";
      const graphic: AiPosterGraphicData = {
        template: "ai_poster",
        headline,
        subline,
        imagePrompt,
        textZone,
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
    // Record this batch's conceptKeys to the generation cooldown so
    // the next batch rotates to fresh themes/visuals. Best-effort —
    // a write failure here doesn't fail the user's request.
    void recordGeneratedConcepts(raw.map((r) => r.conceptKey).filter((k): k is string => !!k));
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

// ── Funny Commercial Scene 1 ────────────────────────────────────────
//
// A single absurd-scene pick per call: themeKey + visualKey (which seed
// it's based on) + a fully-formed Nano Banana prompt. The cooldown
// system uses keys prefixed with `fc:` so it shares the existing
// generated-concepts manifest without colliding with AI-poster keys.

const FC_SCENE1_TOOL = {
  name: "funny_commercial_scene1_results",
  description:
    "Pick ONE absurd-scene idea for a Funny Commercial ad. The image will be generated by Nano Banana 2 and animated by Seedance into a 5-second clip. Pick a theme and a visual within that theme; you may reuse the seed verbatim or extend/rephrase it. The scene must be loud and disruptive — Scene 2 of the ad cuts to a person lying awake in bed listening to muffled noises through the wall, so anything that wouldn't shake an apartment is wrong.",
  input_schema: {
    type: "object" as const,
    properties: {
      pick: {
        type: "object",
        properties: {
          themeKey: {
            type: "string",
            description: "Echo the chosen theme's key exactly (e.g., 'apartment_animal').",
          },
          visualKey: {
            type: "string",
            description:
              "Echo the visual's key exactly (e.g., 'elephant_dance'). If you invent a fresh visual within an existing theme, use a new lowercase snake_case key that fits the theme.",
          },
          imagePrompt: {
            type: "string",
            description:
              "Fully-formed Nano Banana 2 prompt (60-180 words). Pure visual — NO TEXT, no signs, no logos, no captions, no readable typography of any kind. Vertical 9:16. Photorealistic. Describe subject, action, setting (an apartment at night), lighting, lens vibe, motion. The image will be the FIRST frame of a 5-second Seedance animation, so make sure it's a frame the camera can extend forward in time naturally (mid-action, motion blur where appropriate, the subject in the act of being noisy).",
          },
        },
        required: ["themeKey", "visualKey", "imagePrompt"],
      },
    },
    required: ["pick"],
  },
};

export interface FunnyCommercialScene1Pick {
  themeKey: string;
  visualKey: string;
  conceptKey: string;     // "<themeKey>:<visualKey>" with fc: prefix tracking
  imagePrompt: string;
}

export async function generateFunnyCommercialScene1(
  hint?: string,
): Promise<FunnyCommercialScene1Pick> {
  // Build the theme catalog. Mirrors the AI-poster theme prompt shape.
  const themeLibrary = FUNNY_COMMERCIAL_THEMES.map((t, i) => {
    const visuals = t.visuals
      .map((v) => `      - ${t.key}:${v.key} → ${v.seed}`)
      .join("\n");
    return `${i + 1}. THEME ${t.key}  (tone=${t.tone})
   premise: ${t.premise}
   visual options:
${visuals}`;
  }).join("\n\n");

  // Generation cooldown — keep the user from seeing the same scene
  // (or even the same theme) on consecutive batches. Uses the shared
  // generated-concepts manifest with an `fc:` prefix so AI poster
  // history doesn't pollute it.
  const recentlyGenerated = await getRecentGeneratedConcepts(7).catch(() => []);
  const fcRecent = recentlyGenerated
    .filter((k) => k.startsWith("fc:"))
    .map((k) => k.slice(3));
  const recentlyUsedThemeKeys = new Set<string>();
  for (const k of fcRecent) {
    const themeKey = k.includes(":") ? k.split(":")[0] : k;
    recentlyUsedThemeKeys.add(themeKey);
  }
  const dormantThemes = FUNNY_COMMERCIAL_THEMES.map((t) => t.key).filter(
    (k) => !recentlyUsedThemeKeys.has(k),
  );

  const cooldownBlock =
    fcRecent.length > 0
      ? `\n\nRECENTLY SHOWN — pick something else (these appeared in recent batches):
${fcRecent.map((k) => `  - ${k}`).join("\n")}
${dormantThemes.length > 0 ? `Themes the user hasn't seen lately: ${dormantThemes.join(", ")} — favor these.` : ""}`
      : "";

  const hintBlock = hint && hint.trim()
    ? `\n\nUSER HINT (may steer the pick, but you still must pick a theme + visual from the library or invent within an existing theme):
"${hint.trim()}"`
    : "";

  const prompt = `You are picking ONE Scene 1 idea for a Funny Commercial ad. The format is fixed:
  Scene 1 (5s) — a loud absurd scene in an apartment. THIS is what you write.
  Scene 2 (4s) — cut to a person lying awake in bed at night, hearing the muffled noises.
  Scene 3 (3s) — black card, "Time to buy your own place?" → CTA.
  Scene 4 (2s) — Agent Match logo.

So Scene 1's job is ABSURD + LOUD. Anything that would shake the building, wake the neighbors, get someone evicted. Every theme below is built around that.

How to pick:
  1. Pick ONE theme from the library that fits.
  2. Within that theme, pick ONE visual. Pick fresh — don't always reach for the first option.
  3. (Optional) You may invent a new visual within an existing theme if none fits perfectly. Use a snake_case visualKey of your own. Do NOT invent new themes.
  4. Write the imagePrompt — fully-formed, 60-180 words, photorealistic, vertical 9:16, describing a single first-frame moment that the Seedance animator can extend forward into 5 seconds of motion. NO TEXT IN THE IMAGE.

THEME LIBRARY:
${themeLibrary}${cooldownBlock}${hintBlock}

Return your pick by calling the ${FC_SCENE1_TOOL.name} tool exactly once.`;

  try {
    const resp = await client().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [FC_SCENE1_TOOL as unknown as Anthropic.Messages.ToolUnion],
      tool_choice: { type: "tool", name: FC_SCENE1_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    });
    const toolBlock = resp.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error(
        `${FC_SCENE1_TOOL.name} returned no tool_use block (stop_reason=${resp.stop_reason})`,
      );
    }
    const input = toolBlock.input as { pick?: { themeKey?: string; visualKey?: string; imagePrompt?: string } };
    const pick = input.pick;
    if (!pick || !pick.themeKey || !pick.visualKey || !pick.imagePrompt) {
      throw new Error(
        `${FC_SCENE1_TOOL.name} tool call missing pick fields (stop_reason=${resp.stop_reason})`,
      );
    }
    const themeKey = pick.themeKey.trim();
    const visualKey = pick.visualKey.trim();
    const imagePrompt = stripDashes(pick.imagePrompt).trim();
    const conceptKey = `${themeKey}:${visualKey}`;
    // Record under fc: prefix so the cooldown does not pollute the
    // AI poster keyspace.
    void recordGeneratedConcepts([`fc:${conceptKey}`]);
    return { themeKey, visualKey, conceptKey, imagePrompt };
  } catch (e) {
    throw friendlyError(e);
  }
}

// Lightweight translator. The Funny Commercial Scene 3 CTA is authored
// in English, then auto-translated into the active language at render
// time. Translations are short — Haiku is plenty.
const TRANSLATE_MODEL = "claude-haiku-4-5-20251001";
const TRANSLATE_LANG_LABEL: Record<"tl" | "es" | "zh", string> = {
  tl: "Tagalog (as spoken in the Philippines)",
  es: "Spanish (Latin American, neutral)",
  zh: "Mandarin Chinese (Simplified, mainland)",
};

export async function translateText(
  text: string,
  targetLanguage: "tl" | "es" | "zh",
): Promise<string> {
  const prompt = `Translate the following short English marketing line into ${TRANSLATE_LANG_LABEL[targetLanguage]}. Preserve tone and meaning. Return ONLY the translated text, no quotes, no explanation, no transliteration. Keep brand names like "Agent Match" untranslated.

English:
${text.trim()}`;
  try {
    const resp = await client().messages.create({
      model: TRANSLATE_MODEL,
      max_tokens: 512,
      system:
        "You are a careful, idiomatic translator. You return ONLY the translated text, never quotation marks, never explanations.",
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = resp.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Translation returned no text block");
    }
    return textBlock.text.trim();
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
