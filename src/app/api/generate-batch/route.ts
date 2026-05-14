import {
  generateBatch,
  generateGraphicBatch,
  generatePhotoBlendBatch,
  regenerateOne,
} from "@/lib/claude";
import type { BatchRequest, GraphicTemplate } from "@/lib/types";

export const runtime = "nodejs";
// Bumped from 120s — Mandarin batches at max_tokens=32768 stream
// for longer than 2 minutes (ZH characters tokenize ~2x heavier than
// Latin scripts so the per-card cost is roughly doubled). 300s
// matches Vercel Hobby's max-allowed function duration; on Pro the
// hard cap is higher but 300s is plenty for any single static batch.
export const maxDuration = 300;

// Heartbeat-streaming response. iOS Safari (and proxies / load
// balancers) kill connections that go idle for more than ~30s; on
// cellular it's even shorter. Anthropic Sonnet calls take 25-30s
// during which TCP is idle, so we stream a single space byte every
// 3 seconds while waiting and emit the final JSON as the last chunk.
//
// The wire format is plain text: a series of " " (space) heartbeat
// bytes, followed by a single "\n" separator, followed by the result
// JSON. The client splits on "\n", takes the last non-empty piece,
// and parses it as JSON. Heartbeats are bytes the response body has
// already committed, so the connection stays warm even though the
// "real" payload isn't ready yet.
function streamWithHeartbeats<T>(work: Promise<T>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let done = false;
      const tick = setInterval(() => {
        if (done) return;
        try {
          controller.enqueue(encoder.encode(" "));
        } catch {
          // Controller already closed (client disconnected).
        }
      }, 3000);
      try {
        const result = await work;
        done = true;
        clearInterval(tick);
        controller.enqueue(encoder.encode("\n" + JSON.stringify(result)));
        controller.close();
      } catch (e) {
        done = true;
        clearInterval(tick);
        const msg = e instanceof Error ? e.message : "unknown error";
        // 200 OK with an error payload — we already committed body
        // bytes (the heartbeats), so we can't switch to a 5xx status
        // at this point. The client checks for `error` in the JSON.
        controller.enqueue(encoder.encode("\n" + JSON.stringify({ error: msg })));
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Tell intermediate proxies (Vercel edge, mobile carriers) not
      // to buffer — we need every heartbeat to actually flush to the
      // client.
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(req: Request) {
  type RequestBody = BatchRequest & {
    angleKey?: string;
    graphicTemplate?: GraphicTemplate;
    // When true, dispatch to the blended 12-card photo flow across
    // four topical content types instead of the single-content-type
    // photo flow. The body's contentType field is ignored in this
    // case (the blend defines its own pool).
    photoBlend?: boolean;
  };
  let body: RequestBody | null = null;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!body.language) {
    return new Response(
      JSON.stringify({ error: "language is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  // Photo-blend / graphic flows don't need contentType; everything
  // else does.
  const isPhotoBlend = body.photoBlend === true;
  const isGraphic = body.staticSubMode === "graphic";
  if (!isPhotoBlend && !isGraphic && !body.contentType) {
    return new Response(
      JSON.stringify({ error: "contentType is required for single-content-type batches" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Pin types so the closure below doesn't capture nullable refs.
  const reqBody = body;
  const work = (async () => {
    if (reqBody.angleKey) {
      // Per-card regen still goes through the photo-mode tool; graphic
      // posts re-roll via a fresh full batch (smaller, cheaper).
      const post = await regenerateOne(
        reqBody.language,
        reqBody.contentType,
        reqBody.angleKey,
      );
      return { posts: [post] };
    }
    if (isPhotoBlend) {
      return generatePhotoBlendBatch(reqBody.language);
    }
    if (isGraphic) {
      return generateGraphicBatch(reqBody.language, reqBody.graphicTemplate ?? "stat");
    }
    return generateBatch(reqBody.language, reqBody.contentType);
  })();

  return streamWithHeartbeats(work);
}
