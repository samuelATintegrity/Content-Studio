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

export async function animateSourceImage(imageUrl: string): Promise<{ url: string }> {
  const res = await fetch("/api/video/animate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
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
