"use client";

// Funny Commercial — client-side orchestration helpers.
//
// Thin wrappers around /api/funny-commercial/* and /api/translate that
// hide retry / error-shape concerns from the modal components. None of
// these helpers write to the libraryStore directly — that's the
// caller's job, so the UI can choose to discard a generation that
// didn't pan out.

import type { Language } from "./types";

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

// ── Scene 1 generation ─────────────────────────────────────────────

export interface FcScene1Pick {
  themeKey: string;
  visualKey: string;
  conceptKey: string;
  imagePrompt: string;
}

export async function fcPickScene1(hint?: string): Promise<FcScene1Pick> {
  return postJson<FcScene1Pick>(
    "/api/funny-commercial/scene1",
    { hint: hint?.trim() || undefined },
    { label: "Pick Scene 1 idea" },
  );
}

export async function fcGenerateScene1Image(prompt: string): Promise<{ url: string }> {
  return postJson<{ url: string }>(
    "/api/funny-commercial/scene1-image",
    { prompt },
    { label: "Generate Scene 1 image" },
  );
}

// ── Scene 2 actor generation ───────────────────────────────────────

export async function fcGenerateScene2ActorImage(
  hint?: string,
): Promise<{ url: string; prompt: string }> {
  return postJson<{ url: string; prompt: string }>(
    "/api/funny-commercial/scene2-actor",
    { hint: hint?.trim() || undefined },
    { label: "Generate Scene 2 actor image" },
  );
}

// ── Animate any image (Scene 1 or Scene 2 actor) ───────────────────

export async function fcAnimateImage(args: {
  imageUrl: string;
  animationPrompt?: string;
}): Promise<{ url: string }> {
  return postJson<{ url: string }>(
    "/api/video/animate-image",
    {
      imageUrl: args.imageUrl,
      // Seedance is the default; faces work fine here for Scene 2
      // actors (overhead, eyes-open, no lip-sync) so Kling isn't needed.
      model: "seedance",
      animationPrompt: args.animationPrompt?.trim() || undefined,
    },
    { label: "Animate image" },
  );
}

// ── Translation ────────────────────────────────────────────────────

export async function fcTranslate(
  text: string,
  targetLanguage: Exclude<Language, "en">,
): Promise<string> {
  const { translated } = await postJson<{ translated: string }>(
    "/api/translate",
    { text, targetLanguage },
    { label: `Translate to ${targetLanguage}` },
  );
  return translated;
}

// ── Upload (Scene 2 actor uploads reuse the existing upload-clip route)

export async function fcUploadScene2Actor(file: File): Promise<{ cachedUrl: string; filename: string }> {
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
