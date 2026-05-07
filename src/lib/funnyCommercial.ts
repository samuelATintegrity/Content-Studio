"use client";

// Funny Commercial v2 — client-side helpers.
//
// Thin wrappers around /api/funny-commercial/* that hide retry / error-
// shape concerns from the panel components. None of these helpers
// write to the libraryStore directly — that's the caller's job, so the
// UI can choose to discard a generation that didn't pan out.

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

// ── Actor portrait ─────────────────────────────────────────────────

export async function fcGenerateActor(prompt: string): Promise<{ url: string }> {
  return postJson<{ url: string }>(
    "/api/funny-commercial/actor",
    { prompt },
    { label: "Generate actor" },
  );
}

// ── Location backdrop ──────────────────────────────────────────────

export async function fcGenerateLocation(prompt: string): Promise<{ url: string }> {
  return postJson<{ url: string }>(
    "/api/funny-commercial/location",
    { prompt },
    { label: "Generate location" },
  );
}

// ── Shot still (Nano with optional reference images) ───────────────

export async function fcComposeShotImage(args: {
  prompt: string;
  actorReferenceUrl?: string;
  locationImageUrl?: string;
}): Promise<{ url: string }> {
  return postJson<{ url: string }>(
    "/api/funny-commercial/shot/image",
    args,
    { label: "Compose shot image" },
  );
}

// ── Animation prompt (Claude haiku writes a Veo direction) ─────────

export async function fcWriteAnimationPrompt(args: {
  imagePrompt: string;
  kind: "actor" | "crazy";
}): Promise<{ animationPrompt: string }> {
  return postJson<{ animationPrompt: string }>(
    "/api/funny-commercial/animation-prompt",
    args,
    { label: "Write animation prompt" },
  );
}

// ── Animate still → clip via Veo 3.1 + last-frame extraction ───────

export async function fcAnimateShot(args: {
  imageUrl: string;
  animationPrompt: string;
}): Promise<{ videoUrl: string; lastFrameImageUrl?: string }> {
  return postJson<{ videoUrl: string; lastFrameImageUrl?: string }>(
    "/api/funny-commercial/shot/animate",
    args,
    { label: "Animate shot" },
  );
}

// ── Standalone last-frame extraction (re-run if first attempt failed)

export async function fcExtractLastFrame(videoUrl: string): Promise<{ frameUrl: string }> {
  return postJson<{ frameUrl: string }>(
    "/api/funny-commercial/last-frame",
    { videoUrl },
    { label: "Extract last frame" },
  );
}

// ── Upload an mp4 directly into the shots library ──────────────────
// Uses the existing /api/video/upload-clip route which hashes the
// file and mirrors it to R2 under cache/upload/<sha>.mp4. Returned
// URL is what gets dropped into a new FcShot record. The caller is
// responsible for kicking off last-frame extraction afterward.

export async function fcUploadShotVideo(file: File): Promise<{ cachedUrl: string; filename: string }> {
  const res = await fetch("/api/video/upload-clip", {
    method: "POST",
    headers: {
      "content-type": file.type || "video/mp4",
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
