import { NextResponse } from "next/server";
import { translateText } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Body {
  text: string;
  targetLanguage: "tl" | "es" | "zh";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (!["tl", "es", "zh"].includes(body.targetLanguage)) {
      return NextResponse.json(
        { error: "targetLanguage must be one of tl, es, zh" },
        { status: 400 },
      );
    }
    const translated = await translateText(body.text, body.targetLanguage);
    return NextResponse.json({ translated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
