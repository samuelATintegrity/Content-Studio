"use client";

import type {
  ContentType,
  Language,
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

export async function getVideoStatus(jobId: string): Promise<VideoStatusResponse> {
  const res = await fetch(`/api/video/status?jobId=${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "status failed");
  }
  return res.json();
}

export async function regenVideo(
  language: Language,
  contentType: ContentType,
  angleKey: string,
): Promise<{ angle: string; script: string; caption: string; jobId: string }> {
  const res = await fetch("/api/video/regen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, contentType, angleKey }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "regen failed");
  }
  return res.json();
}
