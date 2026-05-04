import { NextResponse } from "next/server";
import { generateBatch, generateGraphicBatch, regenerateOne } from "@/lib/claude";
import type { BatchRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as BatchRequest & { angleKey?: string };
    if (!body.language || !body.contentType) {
      return NextResponse.json({ error: "language and contentType are required" }, { status: 400 });
    }
    if (body.angleKey) {
      // Per-card regen still goes through the photo-mode tool; graphic
      // posts re-roll via a fresh full batch (smaller, cheaper).
      const post = await regenerateOne(body.language, body.contentType, body.angleKey);
      return NextResponse.json({ posts: [post] });
    }
    const result =
      body.staticSubMode === "graphic"
        ? await generateGraphicBatch(body.language, body.contentType)
        : await generateBatch(body.language, body.contentType);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
