import { NextResponse } from "next/server";
import { destroyBufferUpdate } from "@/lib/bufferServer";

// Delete a Buffer update by id. Used by the Scheduled-posts modal's
// per-row delete action.
export const runtime = "nodejs";

interface Body {
  updateId: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    if (!body.updateId) {
      return NextResponse.json({ error: "updateId required" }, { status: 400 });
    }
    await destroyBufferUpdate(body.updateId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
