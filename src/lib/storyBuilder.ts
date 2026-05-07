"use client";

// Story Builder — client-side network helpers.
//
// Thin wrappers around /api/story/* that the panel components call.
// They don't write to the manifest directly — the caller decides
// whether the result is worth persisting (e.g., a generate that the
// user discards never lands in the starting-frame library).

interface FetchOpts extends RequestInit {
  label: string;
}

async function postJson<T>(url: string, body: unknown, opts: FetchOpts): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...opts,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${opts.label}: server returned non-JSON (${res.status})`);
  }
  if (!res.ok) {
    const errMsg =
      (parsed as { error?: string })?.error ?? `${opts.label} failed (${res.status})`;
    throw new Error(errMsg);
  }
  return parsed as T;
}

// ── First-frame: generate via Nano Banana 2 ────────────────────────

export async function storyGenerateFrame(prompt: string): Promise<{ url: string }> {
  return postJson<{ url: string }>(
    "/api/story/frame/generate",
    { prompt },
    { label: "Generate first frame" },
  );
}

// ── First-frame: upload bytes → R2 → returns a stable URL ──────────
//
// Mirrors the /api/video/upload-clip pattern (raw body + x-filename
// header) so the route stays simple and the upload stays deterministic
// (sha-keyed; reuploading the same file is a no-op on R2).

export async function storyUploadFrame(file: File): Promise<{ cachedUrl: string; filename: string }> {
  const res = await fetch("/api/story/frame/upload", {
    method: "POST",
    headers: {
      "content-type": file.type || "image/png",
      "x-filename": file.name,
    },
    body: file,
  });
  const text = await res.text();
  let body: { cachedUrl?: string; filename?: string; error?: string } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`upload returned non-JSON (${res.status})`);
  }
  if (!res.ok) throw new Error(body.error ?? `upload failed (${res.status})`);
  if (!body.cachedUrl || !body.filename) throw new Error("upload returned malformed body");
  return { cachedUrl: body.cachedUrl, filename: body.filename };
}

// ── Animate first frame → clip (Kling) + last-frame extraction ─────

export async function storyAnimateShot(args: {
  imageUrl: string;
  animationPrompt: string;
}): Promise<{ videoUrl: string; lastFrameImageUrl?: string }> {
  return postJson<{ videoUrl: string; lastFrameImageUrl?: string }>(
    "/api/story/shot/animate",
    args,
    { label: "Animate shot" },
  );
}

// ── Stand-alone last-frame extraction (re-run if the original failed)

export async function storyExtractLastFrame(videoUrl: string): Promise<{ frameUrl: string }> {
  return postJson<{ frameUrl: string }>(
    "/api/story/last-frame",
    { videoUrl },
    { label: "Extract last frame" },
  );
}

// ── Optional: Claude Haiku writes an animation prompt from a text seed
//
// Plumbed through as an opt-in helper for the wizard's "Write with AI"
// button. Auto-rewrite on every generate is intentionally NOT done —
// it kept stripping user-specified details (e.g. "free solo, without
// gear" reading as risky and getting sanitized away).

export async function storyWriteAnimationPrompt(args: {
  imagePrompt: string;
}): Promise<{ animationPrompt: string }> {
  return postJson<{ animationPrompt: string }>(
    "/api/story/animation-prompt",
    args,
    { label: "Write animation prompt" },
  );
}
