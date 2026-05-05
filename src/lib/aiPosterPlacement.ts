// Anthropic Vision call: given a bare AI-poster image, decide where
// to composite headline + subline so the type lands on the calmest
// region of the image, in a color that contrasts with that region,
// with an optional gradient scrim if the area is busy.
//
// Used by the ai_poster branch of /api/compose-graphic between Nano
// generation and the ImageResponse compositing step. The call adds
// ~2-3 s per card and ~$0.005; in exchange we never ship a card with
// white text on a white wall (or vice versa).

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey, maxRetries: 2 });
  return _client;
}

const VISION_MODEL = "claude-sonnet-4-6";

export type PosterRegion =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "center"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";
export type PosterTextColor = "white" | "black";
export type PosterScrim = "none" | "bottom-fade" | "top-fade" | "left-fade" | "right-fade" | "vignette";

export interface PosterPlacement {
  region: PosterRegion;
  textColor: PosterTextColor;
  scrim: PosterScrim;
  rationale: string;
  // The focal-subject description Vision produces before picking a
  // region. Captured for debug logs so we can audit bad placements.
  subjectLocation?: string;
}

const PLACEMENT_TOOL = {
  name: "poster_placement",
  description:
    "Pick a layout for compositing a 4-5 word headline + a one-sentence subline over this 1080x1350 image. Goal: the type must read instantly on a phone screen and NEVER sit on top of the focal subject.",
  input_schema: {
    type: "object" as const,
    properties: {
      subjectLocation: {
        type: "string",
        description:
          "REQUIRED FIRST STEP. Describe where the focal subject of this image is in pixel terms. Use thirds: 'upper third / center / left half', 'fills the upper two-thirds, head extends to top edge', 'right two-thirds, with shadow extending to bottom-right', etc. Be specific about edges that extend beyond the main subject mass — a tail, a hand, an object reaching outward — those count as subject too. This grounds your placement choice; do not skip it.",
      },
      region: {
        type: "string",
        enum: [
          "top",
          "bottom",
          "left",
          "right",
          "center",
          "top-left",
          "top-right",
          "bottom-left",
          "bottom-right",
        ],
        description:
          "Which area of the frame the text occupies. HARD RULE: this region MUST NOT intersect subjectLocation. Use full halves (top, bottom, left, right) when the calm zone fills that whole half. Use a CORNER (top-left, top-right, bottom-left, bottom-right) when the subject is centered or vertical and only a corner is fully clear — this also forces the text into a narrower vertical column, leaving the rest of the image breathing room (e.g., a single matchstick centered: bottom-left). 'center' only when the entire frame is calm enough for a vignette.",
      },
      textColor: {
        type: "string",
        enum: ["white", "black"],
        description:
          "Color of the type. DEFAULT IS 'white' — virtually every photographic background reads better with white text + a subtle scrim. Pick 'black' ONLY when the chosen region is dominantly bright (think: white wall, sky-only, paper, snow — >70% of those pixels are very light). On any image with mid-tones, shadows, fur, foliage, water, or mixed lighting, choose white.",
      },
      scrim: {
        type: "string",
        enum: ["none", "bottom-fade", "top-fade", "left-fade", "right-fade", "vignette"],
        description:
          "Gradient overlay behind the text to lift legibility. DEFAULT TO ON: pick 'bottom-fade' for region=bottom, 'top-fade' for region=top, 'left-fade' for region=left, 'right-fade' for region=right, 'vignette' for region=center. Choose 'none' ONLY when the chosen region is a flat block of negative space (single solid color taking up >80% of the region — empty sky, plain wall, blank background). When in doubt, scrim is on.",
      },
      rationale: {
        type: "string",
        description:
          "One short sentence: which constraint above drove your placement, e.g., 'subject in upper two-thirds → bottom; image has mid-tones → white text + bottom-fade'.",
      },
    },
    required: ["subjectLocation", "region", "textColor", "scrim", "rationale"],
  },
};

function buildPrompt(plannedZone?: "top" | "bottom"): string {
  const hintLine = plannedZone
    ? `\nCREATIVE INTENT: this image was generated with the headline planned for the ${plannedZone.toUpperCase()} of the frame. The artist composed the subject in the opposite zone and left the ${plannedZone} as calm negative space. Default to region=${plannedZone} unless the actual generated image clearly diverged from that intent — in which case override with the better placement and note why in rationale.`
    : "";
  return `This is the bare background of a vertical 4:5 social-media poster (1080x1350). I'm about to composite a 4-5 word headline (display weight) plus a one-sentence subline on top of it.${hintLine}

YOUR JOB: pick a placement that NEVER overlaps the focal subject and is legible at thumbnail size.

Procedure (follow in order; do not shortcut):
1. Identify the focal subject and describe its position in subjectLocation. Be specific about edges and outliers — a tail, a hand, smoke, an extended limb, an object reaching outward all count as subject.
2. Pick region. The HARD RULE is: region MUST NOT intersect subjectLocation. If the subject fills the upper half, region=bottom. If the subject reaches into the corners, choose the region furthest from the subject's center of mass. If the subject is vertical or centered (a single matchstick, a standing figure, a centered object), prefer a CORNER (top-left, top-right, bottom-left, bottom-right) so the text becomes a narrow column and the subject keeps full breathing room.
3. Pick textColor. White is the default; only pick black when the chosen region is dominantly bright (white walls, paper, snow, blown-out sky).
4. Pick scrim. Default ON, matched to region. For corners, pick the matching half-fade (top-left/top-right → top-fade; bottom-left/bottom-right → bottom-fade). Pick 'none' ONLY for flat negative-space regions.
5. Write a one-sentence rationale citing which rule drove the choice.

Return your choice via the ${PLACEMENT_TOOL.name} tool. Be decisive.`;
}

// Sensible fallback if the Vision call fails or returns garbage.
// Bottom-fade + white text reads on virtually every photo and is the
// industry-default editorial layout.
const FALLBACK: PosterPlacement = {
  region: "bottom",
  textColor: "white",
  scrim: "bottom-fade",
  rationale: "fallback (vision call failed or returned invalid JSON)",
};

export async function pickPosterPlacement(
  imageBytes: Uint8Array,
  contentType: string = "image/png",
  plannedZone?: "top" | "bottom",
): Promise<PosterPlacement> {
  try {
    const b64 = Buffer.from(imageBytes).toString("base64");
    const resp = await client().messages.create({
      model: VISION_MODEL,
      max_tokens: 512,
      tools: [PLACEMENT_TOOL as unknown as Anthropic.Messages.ToolUnion],
      tool_choice: { type: "tool", name: PLACEMENT_TOOL.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: (contentType === "image/jpeg"
                  ? "image/jpeg"
                  : "image/png") as "image/png" | "image/jpeg",
                data: b64,
              },
            },
            { type: "text", text: buildPrompt(plannedZone) },
          ],
        },
      ],
    });
    // Build a zone-aware fallback: if Vision fails and we know the
    // artist's intent, honor it. Otherwise default to the safe
    // bottom-fade + white layout.
    const zoneFallback: PosterPlacement =
      plannedZone === "top"
        ? {
            region: "top",
            textColor: "white",
            scrim: "top-fade",
            rationale: `fallback (using artist's plannedZone=top)`,
          }
        : FALLBACK;
    const tu = resp.content.find((b) => b.type === "tool_use");
    if (!tu || tu.type !== "tool_use") {
      console.warn("[aiPosterPlacement] vision did not call the tool — using fallback");
      return zoneFallback;
    }
    const input = tu.input as Partial<PosterPlacement>;
    if (!input.region || !input.textColor || !input.scrim) {
      console.warn("[aiPosterPlacement] vision returned partial payload — using fallback", input);
      return zoneFallback;
    }
    const placement: PosterPlacement = {
      region: input.region as PosterRegion,
      textColor: input.textColor as PosterTextColor,
      scrim: input.scrim as PosterScrim,
      rationale: input.rationale ?? "",
      subjectLocation: input.subjectLocation,
    };
    // Surface the Vision call in the function logs so we can audit
    // bad placements after the fact.
    console.log(
      `[aiPosterPlacement] subject="${placement.subjectLocation ?? "?"}" → region=${placement.region} color=${placement.textColor} scrim=${placement.scrim}: ${placement.rationale}`,
    );
    return placement;
  } catch (e) {
    console.warn(
      "[aiPosterPlacement] vision call failed — using fallback:",
      e instanceof Error ? e.message : String(e),
    );
    return FALLBACK;
  }
}
