import { NextResponse } from "next/server";
import { fetchPhoto } from "@/lib/pexels";
import type { ContentType } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { contentType: ContentType; excludeIds?: number[] };
    if (!body.contentType) {
      return NextResponse.json({ error: "contentType required" }, { status: 400 });
    }
    const exclude = new Set(body.excludeIds ?? []);
    const photo = await fetchPhoto(body.contentType, exclude);
    return NextResponse.json(photo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
