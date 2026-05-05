"use client";

import type { ContentType, GenerateBatchResponse, GraphicData, GraphicTemplate, Language, Post, StaticSubMode } from "./types";

interface PhotoResp {
  url: string;
  id: number;
  photographer: string;
  sourceUrl: string;
}

// iOS Safari aggressively kills long-running fetches and surfaces a
// generic TypeError("Load failed") whenever the connection is closed
// before the response arrives — common on cellular, after a tab
// background, or on Wi-Fi/cellular handoff. This helper retries
// transient network failures with exponential backoff and translates
// the iOS error into something a user can act on.
//
// Only network-level errors are retried. A 4xx/5xx response means the
// server actually replied — those are surfaced immediately so the
// caller can read the JSON error body.
function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  // iOS Safari: "Load failed" / "The network connection was lost."
  // Chrome / Firefox: "Failed to fetch" / "NetworkError when attempting to fetch resource."
  // All TypeError, all the same root cause.
  const msg = err.message.toLowerCase();
  return (
    err.name === "TypeError" &&
    (msg.includes("load failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("networkerror") ||
      msg.includes("network connection"))
  );
}

function friendlyNetworkError(err: unknown, label: string): Error {
  if (isTransientNetworkError(err)) {
    return new Error(
      `${label}: connection dropped. Please retry — if you're on cellular, try Wi-Fi.`,
    );
  }
  return err instanceof Error ? err : new Error(`${label}: ${String(err)}`);
}

interface FetchWithRetryOptions extends RequestInit {
  retries?: number;
  retryDelayMs?: number;
  label?: string;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { retries = 2, retryDelayMs = 1500, label = url, ...init } = options;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      if (!isTransientNetworkError(err)) throw err;
      if (attempt < retries) {
        // Exponential-ish backoff: 1.5s, 3s. Long enough for a cellular
        // hiccup to recover but short enough that the user doesn't give up.
        await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
    }
  }
  throw friendlyNetworkError(lastErr, label);
}

// /api/generate-batch streams space bytes every 3 seconds while
// Claude is working, then emits "\n" followed by the result JSON as
// the final chunk. The heartbeat keeps iOS Safari and intermediate
// proxies from idle-killing the connection during the long Anthropic
// call. This helper reads the streamed body and returns the parsed
// payload.
async function readHeartbeatStreamed(res: Response): Promise<unknown> {
  const text = await res.text();
  // Last newline-delimited segment is the JSON payload; everything
  // before it is whitespace heartbeats. Falls back gracefully if the
  // server sent a regular JSON body (e.g. a 4xx with no streaming).
  const idx = text.lastIndexOf("\n");
  const json = idx >= 0 ? text.slice(idx + 1) : text;
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("generate-batch returned malformed payload");
  }
}

export async function fetchBatchCopy(
  language: Language,
  contentType: ContentType,
  staticSubMode?: StaticSubMode,
  graphicTemplate?: GraphicTemplate,
): Promise<GenerateBatchResponse> {
  const res = await fetchWithRetry("/api/generate-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, contentType, staticSubMode, graphicTemplate }),
    label: "Generate batch",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "generate-batch failed" }));
    throw new Error(err.error ?? "generate-batch failed");
  }
  const data = (await readHeartbeatStreamed(res)) as
    | GenerateBatchResponse
    | { error: string };
  if ("error" in data && data.error) throw new Error(data.error);
  return data as GenerateBatchResponse;
}

// Photo-blend variant: when the static UI's "Photo" pill is selected,
// the route fans out 4 parallel single-content-type calls and merges
// the results into a 12-card batch (3 per topic, interleaved). Each
// returned post carries its own contentType so the per-post photo
// lookup pulls the right Pexels query and AI prompt seed.
export async function fetchPhotoBlendCopy(
  language: Language,
): Promise<GenerateBatchResponse> {
  const res = await fetchWithRetry("/api/generate-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, photoBlend: true }),
    label: "Generate photo blend",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "generate-batch failed" }));
    throw new Error(err.error ?? "generate-batch failed");
  }
  const data = (await readHeartbeatStreamed(res)) as
    | GenerateBatchResponse
    | { error: string };
  if ("error" in data && data.error) throw new Error(data.error);
  return data as GenerateBatchResponse;
}

export async function fetchOneCopy(
  language: Language,
  contentType: ContentType,
  angleKey: string,
): Promise<Post> {
  const res = await fetchWithRetry("/api/generate-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, contentType, angleKey }),
    label: "Regenerate copy",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "regenerate-copy failed" }));
    throw new Error(err.error ?? "regenerate-copy failed");
  }
  const data = (await readHeartbeatStreamed(res)) as { posts?: Post[]; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.posts?.[0]) throw new Error("regenerate-copy returned no post");
  return data.posts[0];
}

export async function fetchAiImage(prompt: string): Promise<{ url: string }> {
  const res = await fetchWithRetry("/api/ai-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    label: "AI image",
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "ai-image failed");
  return res.json();
}

// Generate an AI image, mirror it to R2 (so the URL doesn't expire), and
// add it to the local image library so subsequent batches can reuse it.
// Returns the R2 URL (the persistent one) — callers should store this on
// the post rather than the raw fal.ai URL. If the mirror fails, falls
// back to the fal.ai URL so the live UX isn't blocked.
export async function fetchAndCacheAiImage(
  prompt: string,
  category?: string,
): Promise<{ url: string }> {
  const { url: falUrl } = await fetchAiImage(prompt);
  try {
    const { mirrorClip } = await import("@/lib/videoClient");
    const { addLibraryImage } = await import("@/lib/imageLibrary");
    const { cachedUrl } = await mirrorClip({ url: falUrl, kind: "image" });
    addLibraryImage({ url: cachedUrl, prompt, category });
    return { url: cachedUrl };
  } catch (e) {
    console.error("[fetchAndCacheAiImage] mirror/cache failed; using raw fal URL", e);
    return { url: falUrl };
  }
}

export async function fetchPhotoFor(
  contentType: ContentType,
  excludeIds: number[],
): Promise<PhotoResp> {
  const res = await fetchWithRetry("/api/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType, excludeIds }),
    label: "Photo lookup",
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "photo fetch failed");
  return res.json();
}

export async function composeGraphicDataUrl(graphic: GraphicData): Promise<string> {
  const res = await fetchWithRetry("/api/compose-graphic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graphic }),
    label: "Render graphic",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "compose-graphic failed" }));
    throw new Error(err.error ?? "compose-graphic failed");
  }
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Re-encode a PNG data URL as a high-quality JPEG via canvas, on the
// client. AI-poster PNGs are 2-3 MB; JPEG at quality 0.9 brings the
// same image down to ~300-500 KB with no visible loss for social
// posts (Instagram/Facebook re-encode to JPEG server-side anyway).
//
// Why this matters: mobile uploads of 2-3 MB bodies routinely hit
// carrier middlebox compression or Vercel edge size thresholds that
// can mangle the response. Smaller body = no chance of tripping any
// of those. Stat/DYK/Promo PNGs are already tiny (50-90 KB) so this
// no-ops them.
async function shrinkForUpload(dataUrl: string): Promise<{ blob: Blob; mime: string }> {
  // Quick path: tiny PNGs (Stat/DYK/Promo) skip re-encode. The
  // threshold is in characters of the data URL; roughly 1.4 MB raw
  // bytes converts to ~1.9 MB base64 string. Anything below that is
  // already small enough that compression isn't worth the canvas hop.
  const SHRINK_ABOVE = 600 * 1024; // 600 KB of data-URL string
  if (dataUrl.length < SHRINK_ABOVE) {
    const blob = dataUrlToBlob(dataUrl);
    return { blob, mime: blob.type || "image/png" };
  }

  // Canvas re-encode. Wrap in try/catch and fall back to the raw
  // PNG if anything in the canvas pipeline misbehaves on this
  // browser (Safari has historically had quirks).
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image decode failed"));
      i.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    // White background so any transparent regions don't render black
    // when JPEG-flattened. Static posters have no intentional
    // transparency.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpegBlob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
    );
    if (!jpegBlob) throw new Error("canvas.toBlob returned null");
    return { blob: jpegBlob, mime: "image/jpeg" };
  } catch (e) {
    console.warn(
      "[uploadStaticImage] JPEG shrink failed; uploading raw PNG:",
      e instanceof Error ? e.message : e,
    );
    const blob = dataUrlToBlob(dataUrl);
    return { blob, mime: blob.type || "image/png" };
  }
}

// Upload a finished static-post PNG (already rendered as a data URL on
// the client) to R2 and return its public URL. Buffer's GraphQL API
// needs a public URL for the image asset, so this is the prerequisite
// step before the Send-to-Buffer flow on graphic posts.
//
// Reads the body as text first and parses it as JSON ourselves rather
// than calling res.json() directly. When something between the client
// and the route corrupts the response (Vercel edge inserting an HTML
// error page, mobile carrier middlebox swapping bytes, body truncation
// on a slow link, etc.) we want a useful error string, not a cryptic
// "Unexpected token 'e' is not valid JSON".
export async function uploadStaticImage(dataUrl: string): Promise<{ cachedUrl: string }> {
  const { blob, mime } = await shrinkForUpload(dataUrl);
  const res = await fetchWithRetry("/api/static/upload-image", {
    method: "POST",
    headers: { "content-type": mime },
    body: blob,
    label: "Upload image",
    // Generous: a slow mobile uplink on a multi-MB body can take 20s+
    // before any reply, and we don't want to give up before the
    // server has even started reading the body.
    retries: 1,
  });
  const text = await res.text();
  let parsed: { cachedUrl?: string; error?: string } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Body is not JSON — surface a slice of what came back so we can
    // see whether it's an HTML error page, an edge-served notice, etc.
    const preview = text.slice(0, 120).replace(/\s+/g, " ").trim();
    throw new Error(
      `Upload failed: server returned non-JSON (HTTP ${res.status}). First bytes: "${preview}"`,
    );
  }
  if (!res.ok || !parsed?.cachedUrl) {
    throw new Error(parsed?.error ?? `Upload failed (HTTP ${res.status})`);
  }
  return { cachedUrl: parsed.cachedUrl };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
