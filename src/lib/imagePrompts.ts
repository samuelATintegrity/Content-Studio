// 100 short prompts for the AI image generator. Grouped loosely by theme so you
// can scan/edit them; the runtime treats it as one flat array.
export const IMAGE_PROMPTS: readonly string[] = [
  // Real estate agents at work
  "real estate agent in front of a home",
  "real estate agent on the phone",
  "real estate agent showing a couple a house",
  "real estate agent handing keys to new homeowners",
  "real estate agent in a modern office",
  "real estate agent walking through an empty home",
  "real estate agent with clipboard at a property",
  "real estate agent shaking hands with a client",
  "real estate agent reviewing documents at a kitchen table",
  "real estate agent posting a sold sign in a front yard",
  "real estate agent leading a home tour",
  "real estate agent answering questions on the phone",
  "real estate agent at an open house",
  "friendly real estate agent welcoming visitors",
  "real estate agent on a tablet in front of a house",

  // Loan officers and lenders
  "loan officer reviewing paperwork with a client",
  "loan officer at a desk with a laptop and calculator",
  "loan officer explaining mortgage options to a couple",
  "mortgage banker meeting clients at a coffee shop",
  "lender shaking hands with new homeowners",
  "mortgage advisor pointing at numbers on a screen",
  "loan officer on a video call from a home office",
  "loan officer signing documents with clients",

  // Families at home
  "candid photo of a family at home",
  "family unpacking moving boxes in a new home",
  "parents and kids in a sunny new living room",
  "multigenerational family on a front porch",
  "family having dinner in a new dining room",
  "family playing in their backyard",
  "parents cooking together in a new kitchen",
  "children running through an empty new home",
  "family on moving day surrounded by boxes",
  "extended family celebrating a new home",
  "family taking a selfie outside their new house",
  "parents reading to kids on the floor of a new home",
  "family holding the keys to their first home",
  "family in their new front yard at sunset",
  "family decorating their new home together",

  // Young couples
  "young couple in their new home",
  "couple holding keys in front of a house",
  "couple painting a wall in a new home",
  "couple unpacking moving boxes in their new home",
  "couple at the kitchen counter reviewing plans on a tablet",
  "newlyweds in their first home",
  "couple having coffee on the porch of their new home",
  "couple measuring rooms in an empty house",
  "couple celebrating with sparkling drinks in a new home",
  "couple looking at house plans together",
  "couple touring an open house",
  "couple standing on the front steps of a new house",

  // Solo and first-time buyers
  "young woman with keys to her first home",
  "young man on the phone in front of a home",
  "first-time buyer looking at a sold sign",
  "solo homeowner unpacking in a new kitchen",
  "young professional reviewing mortgage documents at home",
  "confident young woman in front of a new house",
  "person holding a home sweet home sign",
  "first-time buyer doing a walkthrough with a notepad",

  // Diverse and multilingual representation
  "Filipino family at home",
  "Latino family in front of a new house",
  "Asian family in a modern living room",
  "Black family celebrating a new home",
  "Hispanic couple unpacking moving boxes",
  "mixed-race family in their kitchen",
  "multicultural family on moving day",
  "Asian American couple with house keys",
  "Latino real estate agent meeting with clients",
  "Filipino loan officer reviewing documents",
  "Spanish-speaking agent in front of a home",
  "Mandarin-speaking real estate professional with clients",

  // House exteriors
  "modern two-story home with manicured lawn",
  "cozy suburban home with autumn leaves",
  "craftsman bungalow with covered porch",
  "ranch-style home with a long driveway",
  "colonial home with white columns",
  "cottage-style home with a flower garden",
  "modern farmhouse with wraparound porch",
  "mid-century modern home in afternoon light",
  "brick townhouse on a tree-lined street",
  "coastal home with white siding and blue sky",
  "tudor-style home in autumn",
  "small starter home with a red front door",
  "condo building with balconies",
  "duplex with two front doors and a shared porch",
  "charming tiny home with curb appeal",

  // Interiors and lifestyle
  "cozy living room with natural light",
  "modern open-concept kitchen",
  "inviting front entryway with a welcome mat",
  "warm foyer with natural wood floors and a console table",
  "dining room set up for a family meal",
  "home office with a window view",
  "empty living room ready to be furnished",
  "bright kitchen with island seating",
  "sunlit reading nook by a window",
  "bathroom with natural wood and stone",

  // Process and transactional moments
  "signing closing documents at a desk",
  "hand holding house keys in front of a sold sign",
  "real estate paperwork spread on a kitchen counter",
  "moving truck parked in front of a new home",
  "opening the front door of a new home for the first time",
] as const;

let lastIndex = -1;
export function randomPrompt(): string {
  if (IMAGE_PROMPTS.length <= 1) return IMAGE_PROMPTS[0] ?? "";
  let idx = Math.floor(Math.random() * IMAGE_PROMPTS.length);
  // Avoid showing the same prompt twice in a row.
  if (idx === lastIndex) idx = (idx + 1) % IMAGE_PROMPTS.length;
  lastIndex = idx;
  return IMAGE_PROMPTS[idx];
}

// Hardcoded AI prompts injected into the first two cards of every batch. The
// language picks an ethnicity hint; English stays unspecified.
import type { ContentType, Language } from "./types";

const ETHNICITY_BY_LANG: Record<Language, string> = {
  en: "",
  es: "hispanic",
  tl: "filipino",
  zh: "chinese",
};

export type BatchSeedIndex = 0 | 1 | 2 | 3;

// Architectural / interior prompts used at index 3. One is randomly
// picked per batch so libraries rotate across the public-facing rooms
// of a home — kitchens, living rooms, foyers, bathrooms, dining rooms.
// Bedrooms intentionally excluded: they read as personal/intimate
// space which clashes with the "buy your own place" pitch tone (per
// user direction 2026-05-08). Foyer/entryway carries the equivalent
// "stepping into a new home" emotional beat without the bedroom vibe.
const INTERIOR_VARIANTS = [
  "a bright sunlit kitchen in a new home, neutral cabinetry, warm natural light, professional real estate photography, no people",
  "a cozy living room in a new home, soft natural light through large windows, neutral decor, professional real estate photography, no people",
  "a clean modern bathroom in a new home, natural materials, soft daylight, professional real estate photography, no people",
  "a welcoming front entryway of a new home, natural wood floors, soft daylight from the open door, professional real estate photography, no people",
  "an inviting foyer with a console table and a wall mirror, hardwood floors, soft natural light from a side window, professional real estate photography, no people",
  "a bright dining room set up for a family meal, natural wood table, large window, professional real estate photography, no people",
] as const;

function pickInterior(): string {
  return INTERIOR_VARIANTS[Math.floor(Math.random() * INTERIOR_VARIANTS.length)];
}

// Architectural exterior prompt at index 2. Single variant for now — keeps
// brand consistent (same kind of "warm, inviting" home aesthetic).
const EXTERIOR_PROMPT =
  "a warm inviting suburban home exterior, golden-hour light, manicured lawn, professional real estate photography, no people, no text or signage";

// Composition guidance appended to the prompt when a textZone is
// known. Keeps the photo realistic but biases the framing so the
// chosen zone has calm enough pixels to land typography on. Vision
// still does the final placement at compose time — this is just to
// nudge the AI photo away from filling the entire frame with the
// subject.
function compositionGuidance(textZone: "top" | "bottom" | undefined): string {
  if (!textZone) return "";
  if (textZone === "top") {
    return ", composition: subject anchored in the lower two-thirds of the frame, leaving the upper third as soft sky / wall / atmospheric background, calm enough for a typography overlay";
  }
  return ", composition: subject in the upper two-thirds of the frame, leaving the lower third as soft floor / blurred background / negative space, calm enough for a typography overlay";
}

export function batchSeedPrompt(
  language: Language,
  contentType: ContentType,
  index: BatchSeedIndex,
  textZone?: "top" | "bottom",
): string {
  const eth = ETHNICITY_BY_LANG[language];
  const ethPart = eth ? `${eth} ` : "";
  const composition = compositionGuidance(textZone);

  // Index 2 + 3 are home shots; ethnicity hint doesn't apply.
  if (index === 2) return EXTERIOR_PROMPT + composition;
  if (index === 3) return pickInterior() + composition;

  if (contentType === "good_agents") {
    // Slot 0: portrait-style, looking at camera, warm smile.
    // Slot 1: candid working — phone call or laptop, focused, not posed.
    if (index === 0) {
      return `a friendly ${ethPart}real estate agent standing in front of a home, professional editorial portrait, warm natural smile, looking at the camera${composition}`;
    }
    return `a ${ethPart}real estate agent on a phone call in a bright modern office, candid professional photography, focused on work, not looking at the camera${composition}`;
  }

  // All other content types: candid lifestyle scenes, no posing, no eye contact
  // with the camera. Still professional quality — editorial/documentary feel.
  if (index === 0) {
    return `a candid lifestyle photo of a ${ethPart}family at home together, unposed, not looking at the camera, sharing a natural everyday moment, soft natural light, professional editorial photography${composition}`;
  }
  return `a candid lifestyle photo of a young ${ethPart}couple in their new home, unposed and natural, looking at each other or off to the side, not looking at the camera, soft natural light, professional editorial photography${composition}`;
}

// Map BatchSeedIndex to a category label for the image library (used for
// future filtering / search — not strictly needed today but cheap to record).
export function categoryFor(index: BatchSeedIndex): string {
  return index === 0 ? "people" : index === 1 ? "couple" : index === 2 ? "exterior" : "interior";
}

export const AI_CREDIT_LABEL = "AI (Nano Banana 2)";
