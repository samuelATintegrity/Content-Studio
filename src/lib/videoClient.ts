"use client";

import type {
  ContentType,
  Language,
  VideoSourcePromptIndex,
  VideoStartResponse,
  VideoStatusResponse,
} from "./types";

export async function startVideoBatch(
  language: Language,
  contentType: ContentType,
): Promise<VideoStartResponse> {
  const res = await fetch("/api/video/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, contentType }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "video start failed");
  }
  return res.json();
}

export async function generateSourceImage(
  promptIndex: VideoSourcePromptIndex,
): Promise<{ url: string }> {
  const res = await fetch("/api/video/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promptIndex }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "generate-image failed");
  }
  return res.json();
}

export type AnimationModel = "seedance" | "kling";

export async function animateSourceImage(
  imageUrl: string,
  model: AnimationModel = "seedance",
): Promise<{ url: string }> {
  const res = await fetch("/api/video/animate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, model }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "animate-image failed");
  }
  return res.json();
}

export async function startVideoRender(args: {
  script: string;
  language: Language;
  contentType: ContentType;
  clipUrls: string[];
}): Promise<{ jobId: string }> {
  const res = await fetch("/api/video/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "render failed");
  }
  return res.json();
}

export async function getVideoStatus(jobId: string): Promise<VideoStatusResponse> {
  const res = await fetch(`/api/video/status?jobId=${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "status failed");
  }
  return res.json();
}

export async function mirrorClip(args: {
  url: string;
  kind: "image" | "video";
}): Promise<{ cachedUrl: string }> {
  const res = await fetch("/api/video/mirror", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "mirror failed");
  }
  return res.json();
}

export async function uploadClip(file: File): Promise<{ cachedUrl: string; filename: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/video/upload-clip", { method: "POST", body: form });
  const text = await res.text();
  let body: { cachedUrl?: string; filename?: string; error?: string } = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Non-JSON response (e.g. Next dev error page). Surface a snippet so
    // future failures are readable instead of "Unexpected token...".
    if (!res.ok) {
      throw new Error(`upload failed (${res.status}): ${text.slice(0, 200)}`);
    }
    throw new Error(`upload returned non-JSON body: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(body.error ?? `upload failed (${res.status})`);
  if (!body.cachedUrl || !body.filename) throw new Error("upload returned malformed body");
  return { cachedUrl: body.cachedUrl, filename: body.filename };
}

export async function regenVideo(args: {
  language: Language;
  contentType: ContentType;
  angleKey: string;
  clipUrls: string[];
}): Promise<{ angle: string; script: string; caption: string; jobId: string }> {
  const res = await fetch("/api/video/regen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "regen failed");
  }
  return res.json();
}
