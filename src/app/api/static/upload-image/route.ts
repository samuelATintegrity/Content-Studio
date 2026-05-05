import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { putBytes } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

// Always answer with JSON, even on the catch-all error path. If we
// throw a stack-trace as text, the client surfaces a confusing
// "Unexpected token 'E' is not valid JSON" instead of the real reason.
const json = (body: unknown, status = 200) =>
  NextResponse.json(body as Record<string, unknown>, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

// Mirror a finished static-post PNG to R2 and return its public URL.
// Used by the Send-to-Buffer flow on graphic posts: Buffer's GraphQL
// API needs a public URL for the image asset, so we have to upload
// the rendered PNG (which currently lives only as a data URL on the
// client) before queueing.
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) {
      return json({ error: "content-type must be image/*" }, 400);
    }

    let buf: Uint8Array;
    try {
      buf = new Uint8Array(await req.arrayBuffer());
    } catch (e) {
      // Most common cause: client aborted, body truncated, or the
      // platform truncated the request because it exceeded an edge
      // body-size limit before reaching the function. We surface this
      // explicitly so a 500 with HTML doesn't leak through.
      const msg = e instanceof Error ? e.message : "body read failed";
      console.error("[upload-image] arrayBuffer failed:", msg);
      return json({ error: `Could not read upload body: ${msg}` }, 400);
    }

    if (buf.byteLength === 0) {
      return json({ error: "empty body" }, 400);
    }
    if (buf.byteLength > MAX_BYTES) {
      return json({ error: `file too large (${buf.byteLength} bytes, max ${MAX_BYTES})` }, 413);
    }

    // SHA-256 keying makes re-uploading the same composed PNG idempotent
    // — same content → same R2 URL. This means picking "Send to Buffer"
    // twice on the same post doesn't upload twice.
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const ext = contentType.includes("jpeg") ? "jpg" : "png";
    const key = `cache/static/${hash}.${ext}`;

    let cachedUrl: string;
    try {
      cachedUrl = await putBytes({
        key,
        body: buf,
        contentType: ext === "jpg" ? "image/jpeg" : "image/png",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "R2 upload failed";
      console.error("[upload-image] R2 putBytes failed:", msg);
      return json({ error: `R2 upload failed: ${msg}` }, 502);
    }

    return json({ cachedUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error("[upload-image] unhandled:", msg);
    return json({ error: msg }, 500);
  }
}
