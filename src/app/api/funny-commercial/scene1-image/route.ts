import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const runtime = "nodejs";
export const maxDuration = 90;

// Scene 1 image: Nano Banana 2 with the Claude-generated imagePrompt.
// 9:16 vertical to match the final video aspect ratio. The Claude
// prompt already includes "vertical 9:16" + "no text" guardrails, but
// we re-state them here as belt-and-suspenders.

const IMAGE_MODEL = "fal-ai/nano-banana-2";

const STYLE_SUFFIX =
  ". Vertical 9:16 portrait orientation, taller than wide. ABSOLUTELY NO TEXT in the image. No letters, no words, no signs, no banners, no captions, no UI, no logos, no readable typography of any kind.";

interface Body {
  prompt: string;
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
    const body = (await req.json()) as Body;
    const trimmed = body.prompt?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }
    configure();
    const result = await fal.subscribe(IMAGE_MODEL, {
      input: {
        prompt: trimmed.replace(/\.$/, "") + STYLE_SUFFIX,
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
    return NextResponse.json({ url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
