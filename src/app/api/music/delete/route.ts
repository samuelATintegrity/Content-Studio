import { NextResponse } from "next/server";
import { deleteKey, keyFromPublicUrl } from "@/lib/r2Server";

export const runtime = "nodejs";

interface Body {
  url: string;
}

// Delete an mp3 from R2 by its public URL. Only objects under the
// music/ prefix are allowed (defense in depth — keeps this route from
// being a generic delete-anything endpoint even though it's already
// password-gated).
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.url) {
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }
    const key = keyFromPublicUrl(body.url);
    if (!key) {
      return NextResponse.json(
        { error: "url is not from this R2 bucket" },
        { status: 400 },
      );
    }
    if (!key.startsWith("music/")) {
      return NextResponse.json(
        { error: "only music/ keys can be deleted via this route" },
        { status: 400 },
      );
    }
    await deleteKey(key);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
