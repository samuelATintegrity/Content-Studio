import { fal } from "@fal-ai/client";

let _configured = false;
function configure() {
  if (_configured) return;
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY is not set in .env.local");
  fal.config({ credentials: key });
  _configured = true;
}

// Nano Banana 2 on fal.ai = Google Gemini 3.1 Flash Image. We ask for a 4:5
// vertical image so it lines up with the post canvas: in plain/light styles
// it fills the canvas exactly; in branded/sepia the bands sit on top and the
// model has been told the top/bottom may be covered.
const MODEL = "fal-ai/nano-banana-2";

const REAL_ESTATE_STYLE_SUFFIX =
  ". Vertical 4:5 portrait orientation, taller than wide. Center the main subject with comfortable space above and below; the very top and bottom may be covered by text bars in some layouts, so do not place key subject matter in the top 16% or bottom 16% of the frame. Professional real estate photography style, photorealistic, natural daylight, sharp detail. No text, signs, or watermarks.";

export async function generateImage(userPrompt: string): Promise<{ url: string }> {
  configure();
  const prompt = userPrompt.trim().replace(/\.$/, "") + REAL_ESTATE_STYLE_SUFFIX;

  const result = await fal.subscribe(MODEL, {
    input: {
      prompt,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: "4:5",
    },
    logs: false,
  });

  type FalImage = { url?: string };
  type FalData = { images?: FalImage[] };
  const data = (result as { data?: FalData }).data;
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai returned no image URL");
  return { url };
}
