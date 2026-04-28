"use client";

import type { ContentType, FitMode, FontVariant, Framing, GenerateBatchResponse, Language, Post, StyleVariant } from "./types";

interface PhotoResp {
  url: string;
  id: number;
  photographer: string;
  sourceUrl: string;
}

export async function fetchBatchCopy(
  language: Language,
  contentType: ContentType,
): Promise<GenerateBatchResponse> {
  const res = await fetch("/api/generate-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, contentType }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "generate-batch failed");
  return res.json();
}

export async function fetchOneCopy(
  language: Language,
  contentType: ContentType,
  angleKey: string,
): Promise<Post> {
  const res = await fetch("/api/generate-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, contentType, angleKey }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "regenerate-copy failed");
  const data = (await res.json()) as { posts: Post[] };
  return data.posts[0];
}

export async function fetchAiImage(prompt: string): Promise<{ url: string }> {
  const res = await fetch("/api/ai-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "ai-image failed");
  return res.json();
}

export async function fetchPhotoFor(
  contentType: ContentType,
  excludeIds: number[],
): Promise<PhotoResp> {
  const res = await fetch("/api/photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType, excludeIds }),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "photo fetch failed");
  return res.json();
}

export async function composeImageDataUrl(args: {
  photoUrl: string;
  headline: string;
  cta: string;
  fontVariant?: FontVariant;
  framing?: Framing;
  fitMode?: FitMode;
  style?: StyleVariant;
}): Promise<string> {
  const res = await fetch("/api/compose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "compose failed" }));
    throw new Error(err.error ?? "compose failed");
  }
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? "image/png";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
