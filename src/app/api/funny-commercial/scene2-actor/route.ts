import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const runtime = "nodejs";
export const maxDuration = 90;

// Scene 2 actor: a static "person lying awake in bed at night, camera
// overhead" frame. Variety comes from a small library of demographic
// hints rotated client-side; Nano Banana 2 produces the still, and the
// caller animates it with Seedance into a 4-second clip.
//
// Hard guardrails: photoreal, vertical 9:16, single person, eyes open,
// camera DIRECTLY overhead (top-down) — not 3/4. This frame must read
// instantly as "lying in bed at night listening to noises."

const IMAGE_MODEL = "fal-ai/nano-banana-2";

const STYLE_SUFFIX =
  ". Photorealistic, vertical 9:16 portrait orientation, taller than wide. Camera is directly overhead, top-down view of the bed and the person's face. The bedroom is quiet and dimly lit by a single bedside lamp or moonlight through a window. The person's eyes are wide open, an expression of mild irritation or tired listening. They are alone in the bed. NO TEXT, no signs, no readable typography, no logos, no watermarks of any kind.";

interface Body {
  // Free-text demographic / styling hint. Optional — defaults are baked
  // into the base prompt below.
  hint?: string;
}

let _configured = false;
function configure() {
  if (_configured) return;
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY is not set in .env.local");
  fal.config({ credentials: key });
  _configured = true;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const hint = body.hint?.trim() || "an adult, somewhere between 25 and 45, casual sleepwear";

    const prompt = `${hint}, lying awake in their bed at night, head on the pillow, blanket pulled up to the chest, listening intently to muffled noises coming through the wall${STYLE_SUFFIX}`;

    configure();
    const result = await fal.subscribe(IMAGE_MODEL, {
      input: {
        prompt,
        num_images: 1,
        output_format: "jpeg",
        aspect_ratio: "9:16",
      } as never,
      logs: false,
    });

    type FalImage = { url?: string };
    type FalData = { images?: FalImage[] };
    const data = (result as { data?: FalData }).data;
    const url = data?.images?.[0]?.url;
    if (!url) throw new Error("fal.ai returned no image URL");

    return NextResponse.json({ url, prompt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
