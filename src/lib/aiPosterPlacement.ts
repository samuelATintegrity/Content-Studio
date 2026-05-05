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

export type PosterRegion = "top" | "bottom" | "left" | "right" | "center";
export type PosterTextColor = "white" | "black";
export type PosterScrim = "none" | "bottom-fade" | "top-fade" | "left-fade" | "right-fade" | "vignette";

export interface PosterPlacement {
  region: PosterRegion;
  textColor: PosterTextColor;
  scrim: PosterScrim;
  rationale: string;
}

const PLACEMENT_TOOL = {
  name: "poster_placement",
  description:
    "Pick a layout for compositing a 4-5 word headline + a one-sentence subline over this 1080x1350 image. Goal: the type must read instantly on a phone screen and never sit on top of the focal subject.",
  input_schema: {
    type: "object" as const,
    properties: {
      region: {
        type: "string",
        enum: ["top", "bottom", "left", "right", "center"],
        description:
          "Which area of the frame the text should occupy. Pick the area with the calmest pixels (low contrast, away from the focal subject). 'center' only when the whole frame is calm enough to scrim.",
      },
      textColor: {
        type: "string",
        enum: ["white", "black"],
        description:
          "Color of the type. 'white' for darker regions; 'black' for lighter regions. Pick the higher-contrast option.",
      },
      scrim: {
        type: "string",
        enum: ["none", "bottom-fade", "top-fade", "left-fade", "right-fade", "vignette"],
        description:
          "Optional gradient overlay behind the text to lift legibility. 'bottom-fade' = dark gradient fading from the bottom up (use with region=bottom + textColor=white). 'top-fade' = mirror. 'left-fade' / 'right-fade' for side-rail layouts. 'vignette' for centered text on a noisy frame. 'none' when the chosen region is calm enough on its own.",
      },
      rationale: {
        type: "string",
        description:
          "One short sentence describing why this placement works for this image — useful for debug logs.",
      },
    },
    required: ["region", "textColor", "scrim", "rationale"],
  },
};

const PROMPT = `This image is the bare background of a vertical 4:5 social-media poster (1080x1350). I'm about to composite a 4-5 word headline (display weight) plus a one-sentence subline on top of it.

Pick the placement so the typography:
- Reads instantly on a phone, even at small thumbnail sizes
- Never sits on top of the focal subject (eyes, faces, key edges)
- Lives in the calmest area of the frame (low contrast, simple)
- Uses the text color that contrasts strongest with whatever it sits on
- Gets a gradient scrim added when the area is too busy to be legible alone

Return your choice via the ${PLACEMENT_TOOL.name} tool. Be decisive — a single best answer, not a discussion.`;

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
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const tu = resp.content.find((b) => b.type === "tool_use");
    if (!tu || tu.type !== "tool_use") {
      console.warn("[aiPosterPlacement] vision did not call the tool — using fallback");
      return FALLBACK;
    }
    const input = tu.input as Partial<PosterPlacement>;
    if (!input.region || !input.textColor || !input.scrim) {
      console.warn("[aiPosterPlacement] vision returned partial payload — using fallback", input);
      return FALLBACK;
    }
    return {
      region: input.region as PosterRegion,
      textColor: input.textColor as PosterTextColor,
      scrim: input.scrim as PosterScrim,
      rationale: input.rationale ?? "",
    };
  } catch (e) {
    console.warn(
      "[aiPosterPlacement] vision call failed — using fallback:",
      e instanceof Error ? e.message : String(e),
    );
    return FALLBACK;
  }
}
