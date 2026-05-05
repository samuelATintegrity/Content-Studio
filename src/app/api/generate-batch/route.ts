import { generateBatch, generateGraphicBatch, regenerateOne } from "@/lib/claude";
import type { BatchRequest, GraphicTemplate } from "@/lib/types";

export const runtime = "nodejs";
// Bumped from 60s — the DYK + Promo prompts grew (industry-stat
// reference doc, multi-pool angle list) and a cold-started function
// hitting Sonnet for ~30s has occasionally clipped the 60s budget.
export const maxDuration = 120;

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
  let body: (BatchRequest & { angleKey?: string; graphicTemplate?: GraphicTemplate }) | null = null;
  try {
    body = (await req.json()) as BatchRequest & {
      angleKey?: string;
      graphicTemplate?: GraphicTemplate;
    };
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!body.language || !body.contentType) {
    return new Response(
      JSON.stringify({ error: "language and contentType are required" }),
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
    return reqBody.staticSubMode === "graphic"
      ? generateGraphicBatch(reqBody.language, reqBody.graphicTemplate ?? "stat")
      : generateBatch(reqBody.language, reqBody.contentType);
  })();

  return streamWithHeartbeats(work);
}
