import { NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { promises as fs } from "node:fs";
import path from "node:path";
import { composeGraphic } from "@/lib/composeGraphic";
import { renderTemplate } from "@/lib/graphicTemplates";
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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.graphic || !body.graphic.template) {
      return NextResponse.json(
        { error: "graphic.template required" },
        { status: 400 },
      );
    }

    // AI poster routes through fal.ai — keep the existing path. Returns
    // a PNG buffer that we wrap in a Response below.
    if (body.graphic.template === "ai_poster") {
      const png = await composeGraphic({
        template: "ai_poster",
        headline: body.graphic.headline,
        subline: body.graphic.subline,
        cta: "Connect with an Agent",
      });
      return new NextResponse(png as unknown as BodyInit, {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    }

    // React templates (stat / dyk / promo) — render via ImageResponse.
    // Logos are inlined as base64 data URLs because Satori's network
    // fetch can't reliably reach the host's own public URL during a
    // function invocation (works on localhost dev, fails silently on
    // Vercel where the request loops back to the deployment).
    if (!_fonts) _fonts = await loadFonts();
    if (!_logos) _logos = await loadLogos();
    const { black: logoBlackUrl, white: logoWhiteUrl } = _logos;

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
