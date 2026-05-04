import { NextResponse } from "next/server";
import { composeGraphic } from "@/lib/composeGraphic";
import type { GraphicTemplate } from "@/lib/types";

export const runtime = "nodejs";
// Nano Banana Pro can take 30-60s per image. The previous 15s cap was
// truncating AI poster runs — the fal.ai dashboard showed the image
// generated successfully but our function had already timed out, so
// the client got a 504 and the image never appeared in the batch.
// 300s matches the longest Vercel Pro-tier function timeout.
export const maxDuration = 300;

interface Body {
  template: GraphicTemplate;
  headline: string;
  subline: string;
  cta: string;
}

// Server-side renderer for graphic-mode static posts. Produces a 1080×1350
// PNG from the chosen SVG template (stat / did_you_know / promo). No
// photo input — the composition is pure brand colors + text.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.template || body.headline === undefined || body.subline === undefined || body.cta === undefined) {
      return NextResponse.json(
        { error: "template, headline, subline, cta required" },
        { status: 400 },
      );
    }

    const png = await composeGraphic({
      template: body.template,
      headline: body.headline,
      subline: body.subline,
      cta: body.cta,
    });

    return new NextResponse(png as unknown as BodyInit, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
