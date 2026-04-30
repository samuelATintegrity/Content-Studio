import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { putBytes } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 60;
const DEPLOY_MARKER = "raw-body-v4";

const MAX_BYTES = 100 * 1024 * 1024;

// Some intermediary (likely Vercel's edge) was compressing the response
// to this route without forwarding the Content-Encoding header, so the
// browser saw raw compressed bytes. Cache-Control: no-transform is the
// standard signal to proxies/CDNs to leave the body alone.
const NO_TRANSFORM_HEADERS = {
  "cache-control": "no-store, no-transform",
  "content-encoding": "identity",
  "x-deploy-marker": DEPLOY_MARKER,
};

export async function GET() {
  return NextResponse.json(
    { marker: DEPLOY_MARKER, accepts: "POST raw body, x-filename header" },
    { headers: NO_TRANSFORM_HEADERS },
  );
}

export async function POST(req: Request) {
  try {
    const filename = req.headers.get("x-filename") ?? "upload.mp4";
    const contentType = req.headers.get("content-type") ?? "video/mp4";
    if (!contentType.startsWith("video/")) {
      return NextResponse.json(
        { error: "content-type must be video/*" },
        { status: 400, headers: NO_TRANSFORM_HEADERS },
      );
    }

    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "empty body" }, { status: 400, headers: NO_TRANSFORM_HEADERS });
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "file too large (>100MB)" }, { status: 413, headers: NO_TRANSFORM_HEADERS });
    }

    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const key = `cache/upload/${hash}.mp4`;

    const cachedUrl = await putBytes({ key, body: buf, contentType });

    return NextResponse.json({ cachedUrl, filename }, { headers: NO_TRANSFORM_HEADERS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json(
      { error: msg, marker: DEPLOY_MARKER },
      { status: 500, headers: NO_TRANSFORM_HEADERS },
    );
  }
}
