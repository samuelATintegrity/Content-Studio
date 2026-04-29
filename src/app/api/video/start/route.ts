import { NextResponse } from "next/server";
import { generateVideoScripts } from "@/lib/videoClaude";
import { enqueueRender } from "@/lib/railwayClient";
import type { ContentType, Language, VideoStartResponse } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface StartBody {
  language: Language;
  contentType: ContentType;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as StartBody;
    if (!body.language || !body.contentType) {
      return NextResponse.json({ error: "language and contentType are required" }, { status: 400 });
    }

    const scripts = await generateVideoScripts(body.language, body.contentType);
    if (scripts.length === 0) {
      return NextResponse.json({ error: "Claude returned no scripts" }, { status: 502 });
    }

    // Enqueue all 3 renders in parallel; one failure shouldn't kill the others.
    const enqueueResults = await Promise.allSettled(
      scripts.map((s) =>
        enqueueRender({ script: s.script, language: body.language, contentType: body.contentType }),
      ),
    );

    const jobs: VideoStartResponse["jobs"] = [];
    const errors: string[] = [];
    for (let i = 0; i < scripts.length; i++) {
      const r = enqueueResults[i];
      const s = scripts[i];
      if (!r || !s) continue;
      if (r.status === "fulfilled") {
        jobs.push({ angle: s.angle, script: s.script, caption: s.caption, jobId: r.value });
      } else {
        errors.push(`${s.angle}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    }

    if (jobs.length === 0) {
      return NextResponse.json(
        { error: `All renders failed to enqueue: ${errors.join("; ")}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ jobs } satisfies VideoStartResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
