import type { FastifyRequest, FastifyReply } from "fastify";

// Shared-secret header check. Every request that touches a real endpoint
// must include `X-Worker-Secret: <RAILWAY_API_SHARED_SECRET>`. /healthz is
// the one route that bypasses this so Railway's health probes work.
export async function requireSharedSecret(req: FastifyRequest, reply: FastifyReply) {
  const expected = process.env.RAILWAY_API_SHARED_SECRET;
  if (!expected) {
    // Fail closed if the env isn't configured — better to 500 than to be open.
    reply.code(500).send({ error: "RAILWAY_API_SHARED_SECRET is not configured" });
    return;
  }
  const provided = req.headers["x-worker-secret"];
  if (typeof provided !== "string" || provided !== expected) {
    reply.code(401).send({ error: "Unauthorized" });
    return;
  }
}
