// Server-only thin client over the Railway worker. Keeps the shared-secret
// header in one place and surfaces typed responses.

import type { ContentType, Language, VideoStatusResponse } from "./types";

interface WorkerConfig {
  baseUrl: string;
  secret: string;
}

function config(): WorkerConfig {
  const baseUrl = process.env.RAILWAY_WORKER_URL;
  const secret = process.env.RAILWAY_API_SHARED_SECRET;
  if (!baseUrl) throw new Error("RAILWAY_WORKER_URL is not set");
  if (!secret) throw new Error("RAILWAY_API_SHARED_SECRET is not set");
  return { baseUrl: baseUrl.replace(/\/$/, ""), secret };
}

async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { baseUrl, secret } = config();
  const headers = new Headers(init.headers);
  headers.set("X-Worker-Secret", secret);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

export async function enqueueRender(args: {
  script: string;
  language: Language;
  contentType: ContentType;
  clipUrls: string[];
  mode?: "narration" | "influencer";
  voiceId?: string;
  introClipUrl?: string;
  introCaptionCutoffPhrase?: string;
  outroClipUrl?: string;
  outroCaptionCutoffPhrase?: string;
}): Promise<string> {
  if (!Array.isArray(args.clipUrls) || args.clipUrls.length === 0) {
    throw new Error("enqueueRender: clipUrls is required");
  }
  const res = await workerFetch("/render", {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Worker /render failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { jobId?: string };
  if (!json.jobId) throw new Error("Worker /render did not return a jobId");
  return json.jobId;
}

export async function mirrorClipToR2(args: {
  url: string;
  kind: "image" | "video";
}): Promise<string> {
  const res = await workerFetch("/cache-clip", {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Worker /cache-clip failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { cachedUrl?: string };
  if (!json.cachedUrl) throw new Error("Worker /cache-clip did not return a cachedUrl");
  return json.cachedUrl;
}

export async function tagClipViaWorker(args: { url: string }): Promise<string[]> {
  const res = await workerFetch("/tag-clip", {
    method: "POST",
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Worker /tag-clip failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { tags?: string[] };
  if (!Array.isArray(json.tags)) throw new Error("Worker /tag-clip did not return tags");
  return json.tags;
}

export async function getRenderStatus(jobId: string): Promise<VideoStatusResponse> {
  const res = await workerFetch(`/status/${encodeURIComponent(jobId)}`, { method: "GET" });
  if (res.status === 404) {
    throw new Error("Job not found");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Worker /status failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as VideoStatusResponse;
}
