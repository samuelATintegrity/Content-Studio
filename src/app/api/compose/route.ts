import { NextResponse } from "next/server";
import { composeImage } from "@/lib/compose";
import type { FontVariant } from "../../../../brand.config";
import type { FitMode, Framing, StyleVariant } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface ComposeBody {
  photoUrl: string;
  headline: string;
  cta: string;
  handle?: string;
  fontVariant?: FontVariant;
  framing?: Framing;
  fitMode?: FitMode;
  style?: StyleVariant;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ComposeBody;
    if (!body.photoUrl || body.headline === undefined || body.cta === undefined) {
      return NextResponse.json(
        { error: "photoUrl, headline, cta required" },
        { status: 400 },
      );
    }

    const photoRes = await fetch(body.photoUrl);
    if (!photoRes.ok) {
      return NextResponse.json(
        { error: `failed to fetch photo (${photoRes.status})` },
        { status: 502 },
      );
    }
    const photoBytes = Buffer.from(await photoRes.arrayBuffer());

    const png = await composeImage({
      photoBytes,
      headline: body.headline,
      cta: body.cta,
      handle: body.handle,
      fontVariant: body.fontVariant,
      framing: body.framing,
      fitMode: body.fitMode,
      style: body.style,
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
