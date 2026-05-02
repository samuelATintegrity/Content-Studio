import { NextResponse } from "next/server";
import { getObjectBytes, putBytes } from "@/lib/r2Server";

// Shared library manifest — clip library + saved sets + image library —
// stored as one JSON blob in R2 so the data follows the password rather
// than the device. Last-write-wins concurrency: fine for a single-user-
// with-shared-password tool.

export const runtime = "nodejs";

const MANIFEST_KEY = "library/manifest.json";

export async function GET() {
  try {
    const bytes = await getObjectBytes(MANIFEST_KEY);
    if (!bytes) {
      // Signal "not yet created" so the client can run the localStorage
      // migration on first load instead of overwriting with empty state.
      return NextResponse.json({ exists: false }, { status: 404 });
    }
    const text = new TextDecoder().decode(bytes);
    // Pass through whatever JSON the client wrote — schema lives on the
    // client side. We just check it parses.
    const parsed = JSON.parse(text);
    return NextResponse.json(parsed, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "library read failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.text();
    if (!body) {
      return NextResponse.json({ error: "empty body" }, { status: 400 });
    }
    // Parse + reserialize so we reject malformed JSON before writing.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    const serialized = JSON.stringify(parsed);
    await putBytes({
      key: MANIFEST_KEY,
      body: new TextEncoder().encode(serialized),
      contentType: "application/json; charset=utf-8",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "library write failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
