import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { putBytes } from "@/lib/r2Server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const entry = form.get("file");
    if (!entry || typeof entry === "string") {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }
    const file = entry as File;
    if (!file.type.startsWith("video/")) {
      return NextResponse.json({ error: "file must be a video" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "file too large (>100MB)" }, { status: 413 });
    }

    const buf = new Uint8Array(await file.arrayBuffer());
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
    const key = `cache/upload/${hash}.mp4`;

    const cachedUrl = await putBytes({
      key,
      body: buf,
      contentType: file.type || "video/mp4",
    });

    return NextResponse.json({ cachedUrl, filename: file.name });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
