import Fastify from "fastify";
import { createJob, getJob, reapOldJobs } from "./jobs.js";
import { requireSharedSecret } from "./auth.js";
import { runPipeline } from "./pipeline.js";
import { cacheClip } from "./cache.js";
import type { RenderRequest, RenderResponse, StatusResponse } from "./types.js";

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  // Allow up to 1MB request bodies (script text + metadata is well under).
  bodyLimit: 1024 * 1024,
});

// Health check — no auth, used by Railway's health probes.
app.get("/healthz", async () => ({ ok: true, ts: Date.now() }));

// All other routes require the shared-secret header.
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/healthz" || req.url.startsWith("/healthz?")) return;
  await requireSharedSecret(req, reply);
});

// POST /render — enqueue a new render job.
app.post<{ Body: RenderRequest; Reply: RenderResponse | { error: string } }>(
  "/render",
  async (req, reply) => {
    const body = req.body;
    if (!body?.script?.trim() || !body.language || !body.contentType) {
      reply.code(400);
      return { error: "script, language, contentType are required" };
    }
    const job = createJob();
    // Fire-and-forget: pipeline runs in the background; client polls /status.
    runPipeline(job.id, body).catch((e) => {
      app.log.error({ err: e, jobId: job.id }, "pipeline error (uncaught)");
    });
    return { jobId: job.id };
  },
);

// POST /cache-clip — mirror a fal.ai URL into R2. Used by the app to save
// approved image+clip pairs that the user can reuse on later batches.
app.post<{
  Body: { url?: string; kind?: "image" | "video" };
  Reply: { cachedUrl: string } | { error: string };
}>("/cache-clip", async (req, reply) => {
  const url = req.body?.url;
  const kind = req.body?.kind;
  if (!url || (kind !== "image" && kind !== "video")) {
    reply.code(400);
    return { error: "url and kind ('image' | 'video') are required" };
  }
  try {
    const cachedUrl = await cacheClip(url, kind);
    return { cachedUrl };
  } catch (e) {
    reply.code(500);
    return { error: e instanceof Error ? e.message : "cache failed" };
  }
});

// GET /status/:id — poll job state.
app.get<{ Params: { id: string }; Reply: StatusResponse | { error: string } }>(
  "/status/:id",
  async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) {
      reply.code(404);
      return { error: "Job not found" };
    }
    return {
      state: job.state,
      progress: job.progress,
      ...(job.videoUrl ? { videoUrl: job.videoUrl } : {}),
      ...(job.durationS !== undefined ? { durationS: job.durationS } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  },
);

// Periodically clear out terminal jobs older than 24h.
const reapInterval = setInterval(() => {
  const removed = reapOldJobs();
  if (removed > 0) app.log.info({ removed }, "reaped old jobs");
}, 1000 * 60 * 30);
reapInterval.unref();

const port = Number(process.env.PORT ?? 8080);
const host = "0.0.0.0";

app
  .listen({ port, host })
  .then(() => {
    app.log.info({ port, host }, "content-studio worker listening");
  })
  .catch((err) => {
    app.log.error(err, "failed to start");
    process.exit(1);
  });

// Graceful shutdown so Railway's redeploys don't drop in-flight jobs.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    app.log.info({ sig }, "shutting down");
    await app.close();
    process.exit(0);
  });
}
