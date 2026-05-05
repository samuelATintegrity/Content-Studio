import { NextResponse } from "next/server";
import { generateFunnyCommercialScene1 } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  hint?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const pick = await generateFunnyCommercialScene1(body.hint);
    return NextResponse.json(pick);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
