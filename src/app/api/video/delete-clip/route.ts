import { NextResponse } from "next/server";
import { deleteKey, keyFromPublicUrl } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_TRANSFORM_HEADERS = {
  "cache-control": "no-store, no-transform",
  "content-encoding": "identity",
};

interface Body {
  urls: string[]; // every URL associated with the clip (video + poster, etc.)
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      return NextResponse.json(
        { error: "urls (string[]) required" },
        { status: 400, headers: NO_TRANSFORM_HEADERS },
      );
    }

    const deleted: string[] = [];
    const skipped: { url: string; reason: string }[] = [];

    for (const url of body.urls) {
      const key = keyFromPublicUrl(url);
      if (!key) {
        skipped.push({ url, reason: "not in our R2 bucket" });
        continue;
      }
      try {
        await deleteKey(key);
        deleted.push(key);
      } catch (e) {
        skipped.push({ url, reason: e instanceof Error ? e.message : "delete failed" });
      }
    }

    return NextResponse.json({ deleted, skipped }, { headers: NO_TRANSFORM_HEADERS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500, headers: NO_TRANSFORM_HEADERS });
  }
}
