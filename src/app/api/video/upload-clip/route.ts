import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { putBytes } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 100 * 1024 * 1024;

// Body is the raw file bytes. Filename + content-type travel in headers
// (x-filename, content-type) — multipart parsing was producing a mangled
// response in Next 16 dev mode, so we sidestep it.
export async function POST(req: Request) {
  try {
    const filename = req.headers.get("x-filename") ?? "upload.mp4";
    const contentType = req.headers.get("content-type") ?? "video/mp4";
    if (!contentType.startsWith("video/")) {
      return NextResponse.json({ error: "content-type must be video/*" }, { status: 400 });
    }

    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) {
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "file too large (>100MB)" }, { status: 413 });
    }

    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const key = `cache/upload/${hash}.mp4`;

    const cachedUrl = await putBytes({ key, body: buf, contentType });

    return NextResponse.json({ cachedUrl, filename });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
