import { NextResponse } from "next/server";
import { writeUploadCaption } from "@/lib/claude";
import { buildCaption } from "@/lib/copy";
import type { ContentType, Language } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/upload/draft-caption
//
// Body:
//   {
//     source: string,            // Whisper transcript OR Vision description
//     sourceKind: "video" | "image",
//     language: Language,
//     contentType: ContentType,
//   }
//
// Returns:
//   {
//     body: string,              // raw caption body (3-5 sentences + hashtags)
//     caption: string,           // pre-built full caption (URL + form line + body)
//   }
//
// The frontend can render `caption` directly into the editable textarea
// and ship it straight to Buffer when the user is happy with it.

interface Body {
  source: string;
  sourceKind: "video" | "image";
  language: Language;
  contentType: ContentType;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.source?.trim()) {
      return NextResponse.json({ error: "source is required" }, { status: 400 });
    }
    if (body.sourceKind !== "video" && body.sourceKind !== "image") {
      return NextResponse.json(
        { error: "sourceKind must be 'video' or 'image'" },
        { status: 400 },
      );
    }
    if (!body.language) {
      return NextResponse.json({ error: "language is required" }, { status: 400 });
    }
    if (!body.contentType) {
      return NextResponse.json({ error: "contentType is required" }, { status: 400 });
    }

    const draftBody = await writeUploadCaption({
      source: body.source,
      sourceKind: body.sourceKind,
      language: body.language,
      contentType: body.contentType,
    });
    const caption = buildCaption(body.language, body.contentType, draftBody);
    return NextResponse.json({ body: draftBody, caption });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
