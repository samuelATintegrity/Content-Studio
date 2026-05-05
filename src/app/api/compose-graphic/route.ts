import { NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderTemplate } from "@/lib/graphicTemplates";
import { generateBareAiPoster } from "@/lib/fal";
import { pickPosterPlacement } from "@/lib/aiPosterPlacement";
import { getObjectBytes, putBytes } from "@/lib/r2Server";
import type { GraphicData } from "@/lib/types";

export const runtime = "nodejs";
// Both paths can be slow: ai_poster waits on Nano Banana Pro (30-60s);
// React rendering is fast (~1s) but we share the route + budget. 300s
// matches the longest Vercel Pro-tier function timeout.
export const maxDuration = 300;

interface Body {
  graphic: GraphicData;
}

// Cache fonts + logos in module scope so warm function invocations don't
// re-read from disk. Loaded lazily on first call.
let _fonts: Awaited<ReturnType<typeof loadFonts>> | null = null;
let _logos: { black: string; white: string } | null = null;

async function loadLogos() {
  const brandDir = path.join(process.cwd(), "public", "brand");
  const [black, white] = await Promise.all([
    fs.readFile(path.join(brandDir, "logo-black.png")),
    fs.readFile(path.join(brandDir, "logo-white.png")),
  ]);
  return {
    black: `data:image/png;base64,${black.toString("base64")}`,
    white: `data:image/png;base64,${white.toString("base64")}`,
  };
}

async function loadFonts() {
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  const read = (file: string) => fs.readFile(path.join(fontsDir, file));
  const [
    geistMedium,
    geistSemiBold,
    geistBold,
    geistExtraBold,
    geistBlack,
    jbmRegular,
    jbmMedium,
  ] = await Promise.all([
    read("Geist-Medium.ttf"),
    read("Geist-SemiBold.ttf"),
    read("Geist-Bold.ttf"),
    read("Geist-ExtraBold.ttf"),
    read("Geist-Black.ttf"),
    read("JetBrainsMono-Regular.ttf"),
    read("JetBrainsMono-Medium.ttf"),
  ]);
  // Each ImageResponse fonts entry binds a (family, weight) → buffer.
  return [
    { name: "Geist", data: geistMedium, weight: 500 as const, style: "normal" as const },
    { name: "Geist", data: geistSemiBold, weight: 600 as const, style: "normal" as const },
    { name: "Geist", data: geistBold, weight: 700 as const, style: "normal" as const },
    { name: "Geist", data: geistExtraBold, weight: 800 as const, style: "normal" as const },
    { name: "Geist", data: geistBlack, weight: 900 as const, style: "normal" as const },
    { name: "JetBrainsMono", data: jbmRegular, weight: 400 as const, style: "normal" as const },
    { name: "JetBrainsMono", data: jbmMedium, weight: 500 as const, style: "normal" as const },
  ];
}

// AI poster v2: fetch-or-generate the bare image, hashed by its prompt
// so a regen with the same prompt is free. Returns the PNG bytes plus
// the public URL (for debugging) — callers should base64 the bytes
// and feed them to ImageResponse as a data URL.
async function getOrGenerateBareAiPoster(prompt: string): Promise<Uint8Array> {
  const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 32);
  const key = `cache/ai-poster-bare/${hash}.png`;

  // Cache hit?
  const cached = await getObjectBytes(key).catch((e) => {
    console.warn("[compose-graphic] R2 cache lookup failed:", e instanceof Error ? e.message : e);
    return null;
  });
  if (cached) return cached;

  // Cache miss — generate via Nano, mirror to R2, return bytes.
  const { url } = await generateBareAiPoster(prompt);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Bare poster fetch from fal failed: ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  // Best-effort R2 mirror; don't fail the request if R2 hiccups.
  try {
    await putBytes({ key, body: bytes, contentType: "image/png" });
  } catch (e) {
    console.warn(
      "[compose-graphic] R2 mirror failed (proceeding anyway):",
      e instanceof Error ? e.message : e,
    );
  }
  return bytes;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.graphic || !body.graphic.template) {
      return NextResponse.json(
        { error: "graphic.template required" },
        { status: 400 },
      );
    }

    // Shared lazy-loads for fonts + logos.
    if (!_fonts) _fonts = await loadFonts();
    if (!_logos) _logos = await loadLogos();
    const { black: logoBlackUrl, white: logoWhiteUrl } = _logos;

    // ai_poster: 3-stage pipeline.
    //   1. Look up / generate the bare image (hashed by imagePrompt).
    //   2. Ask Claude Vision where to place the text + which color +
    //      whether a scrim is needed.
    //   3. Render the AiPosterCompositeLight component through
    //      ImageResponse, just like the other graphic templates.
    if (body.graphic.template === "ai_poster") {
      if (!body.graphic.imagePrompt) {
        return NextResponse.json(
          { error: "ai_poster requires imagePrompt" },
          { status: 400 },
        );
      }
      const imageBytes = await getOrGenerateBareAiPoster(body.graphic.imagePrompt);
      // Pass Claude's planned text zone (top or bottom) to Vision as
      // the strong default — Vision still confirms or overrides based
      // on what the actual generated image looks like, but starts from
      // the artist's intent rather than guessing from scratch.
      const placement = await pickPosterPlacement(
        imageBytes,
        "image/png",
        body.graphic.textZone,
      );
      const imageDataUrl = `data:image/png;base64,${Buffer.from(imageBytes).toString("base64")}`;

      const element = renderTemplate({
        graphic: body.graphic,
        logoBlackUrl,
        logoWhiteUrl,
        aiPosterImage: imageDataUrl,
        aiPosterPlacement: placement,
      });

      return new ImageResponse(element, {
        width: 1080,
        height: 1350,
        fonts: _fonts,
      });
    }

    // photo: same ImageResponse + Vision pipeline as ai_poster, but
    // the background is a user-supplied photo URL (Pexels, R2 cache,
    // or fal.ai CDN) instead of a Nano-generated bare image. Plain
    // mode renders the bare photo with just a wordmark; Overlay mode
    // composites grouped headline + cta with halo + scrim.
    if (body.graphic.template === "photo") {
      if (!body.graphic.photoUrl) {
        return NextResponse.json(
          { error: "photo requires photoUrl" },
          { status: 400 },
        );
      }
      let imageBytes: Uint8Array;
      try {
        const res = await fetch(body.graphic.photoUrl);
        if (!res.ok) {
          return NextResponse.json(
            { error: `photo fetch failed: HTTP ${res.status}` },
            { status: 502 },
          );
        }
        imageBytes = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: `photo fetch failed: ${msg}` }, { status: 502 });
      }
      // Determine the source content type so the Vision call hands
      // Anthropic the right media_type. Pexels usually serves jpeg.
      const photoContentType = body.graphic.photoUrl.match(/\.png(\?|$)/i)
        ? "image/png"
        : "image/jpeg";
      // Plain mode skips the Vision call entirely — there's no text
      // to place — but still renders through ImageResponse so the
      // wordmark sits cleanly in the corner. Pass a fixed placement
      // so renderTemplate's photo branch is happy.
      const placement = body.graphic.plain
        ? {
            region: "bottom" as const,
            textColor: "white" as const,
            scrim: "none" as const,
            rationale: "plain mode (no text overlay)",
          }
        : await pickPosterPlacement(
            imageBytes,
            photoContentType,
            body.graphic.textZone,
          );
      const mime = photoContentType;
      const imageDataUrl = `data:${mime};base64,${Buffer.from(imageBytes).toString("base64")}`;

      const element = renderTemplate({
        graphic: body.graphic,
        logoBlackUrl,
        logoWhiteUrl,
        aiPosterImage: imageDataUrl,
        aiPosterPlacement: placement,
      });

      return new ImageResponse(element, {
        width: 1080,
        height: 1350,
        fonts: _fonts,
      });
    }

    // React templates (stat / dyk / promo) — render via ImageResponse.
    // Logos are inlined as base64 data URLs because Satori's network
    // fetch can't reliably reach the host's own public URL during a
    // function invocation (works on localhost dev, fails silently on
    // Vercel where the request loops back to the deployment).
    const element = renderTemplate({
      graphic: body.graphic,
      logoBlackUrl,
      logoWhiteUrl,
    });

    const response = new ImageResponse(element, {
      width: 1080,
      height: 1350,
      fonts: _fonts,
    });

    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[compose-graphic] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
