import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { putBytes } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

// Mirror a finished static-post PNG to R2 and return its public URL.
// Used by the Send-to-Buffer flow on graphic posts: Buffer's GraphQL
// API needs a public URL for the image asset, so we have to upload
// the rendered PNG (which currently lives only as a data URL on the
// client) before queueing.
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json(
        { error: "content-type must be image/*" },
        { status: 400 },
      );
    }

    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "file too large (>15MB)" }, { status: 413 });
    }

    // SHA-256 keying makes re-uploading the same composed PNG idempotent
    // — same content → same R2 URL. This means picking "Send to Buffer"
    // twice on the same post doesn't upload twice.
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const key = `cache/static/${hash}.${ext}`;

    const cachedUrl = await putBytes({
      key,
      body: buf,
      contentType: ext === "jpg" ? "image/jpeg" : "image/png",
    });

    return NextResponse.json({ cachedUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
