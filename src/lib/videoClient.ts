"use client";

import type {
  ContentType,
  Language,
  MessageTheme,
  VideoSourcePromptIndex,
  VideoStartResponse,
  VideoStatusResponse,
} from "./types";

export async function startVideoBatch(
  language: Language,
  messageTheme: MessageTheme,
): Promise<VideoStartResponse> {
  const res = await fetch("/api/video/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, messageTheme }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "video start failed");
  }
  return res.json();
}

// Influencer-mode script generation. Returns 3 conversational middle
// scripts (one per angle from the good_agents content type), each tied
// to the chosen avatar.
export interface InfluencerScript {
  angle: string;
  script: string;
  caption: string;
}

export async function startInfluencerScript(args: {
  language: Language;
  contentType: ContentType;
  avatarName: string;
  messageTheme: MessageTheme;
}): Promise<InfluencerScript[]> {
  const res = await fetch("/api/video/start-influencer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(
      (await res.json().catch(() => ({}))).error ?? "influencer start failed",
    );
  }
  const json = (await res.json()) as { scripts?: InfluencerScript[] };
  if (!Array.isArray(json.scripts) || json.scripts.length === 0) {
    throw new Error("influencer start returned no scripts");
  }
  return json.scripts;
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

// Manual AI clip flow: user-supplied prompt → 9:16 image. Same Nano Banana
// 2 model + style suffix as the slot generator, so results match the rest
// of the library visually.
export async function generateCustomImage(prompt: string): Promise<{ url: string }> {
  const res = await fetch("/api/video/generate-image-custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "custom-image failed");
  }
  return res.json();
}

export type AnimationModel = "seedance" | "kling" | "veo";

export async function animateSourceImage(
  imageUrl: string,
  model: AnimationModel = "seedance",
  animationPrompt?: string,
): Promise<{ url: string }> {
  const res = await fetch("/api/video/animate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, model, animationPrompt }),
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
  // Optional override for the language-default narration voice. Set
  // when the narration flow wants to render in a specific avatar's
  // voice (today: Sarah for the new endorser style).
  voiceId?: string;
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

// Influencer-mode render. Same /render endpoint, mode-dispatched on the
// worker. clipUrls here is the middle filler list (1..INFLUENCER_MIDDLE_MAX).
export async function startInfluencerRender(args: {
  script: string;
  language: Language;
  contentType: ContentType;
  voiceId: string;
  introClipUrl: string;
  introCaptionCutoffPhrase?: string;
  middleClipUrls: string[];
  outroClipUrl: string;
  outroCaptionCutoffPhrase?: string;
  musicShuffleIndex?: number;
}): Promise<{ jobId: string }> {
  const res = await fetch("/api/video/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      script: args.script,
      language: args.language,
      contentType: args.contentType,
      clipUrls: args.middleClipUrls,
      mode: "influencer",
      voiceId: args.voiceId,
      introClipUrl: args.introClipUrl,
      introCaptionCutoffPhrase: args.introCaptionCutoffPhrase,
      outroClipUrl: args.outroClipUrl,
      outroCaptionCutoffPhrase: args.outroCaptionCutoffPhrase,
      musicShuffleIndex: args.musicShuffleIndex,
    }),
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
  // Stream the file as the raw body (NOT multipart) — Next 16 dev was
  // returning a mangled response for multipart POSTs. See server route.
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
  let parsed = false;
  try {
    body = text ? JSON.parse(text) : {};
    parsed = true;
  } catch {
    /* fall through */
  }
  if (!parsed) {
    console.error("[uploadClip] non-JSON response", { status: res.status, headers: Object.fromEntries(res.headers), body: text });
    throw new Error(`upload returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    console.error("[uploadClip] error response", { status: res.status, body });
    throw new Error(body.error ?? `upload failed (${res.status})`);
  }
  if (!body.cachedUrl || !body.filename) {
    console.error("[uploadClip] malformed body", body);
    throw new Error("upload returned malformed body");
  }
  return { cachedUrl: body.cachedUrl, filename: body.filename };
}

export async function tagClip(url: string): Promise<string[]> {
  const res = await fetch("/api/video/tag-clip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "tag failed");
  }
  const body = (await res.json()) as { tags?: string[] };
  return Array.isArray(body.tags) ? body.tags : [];
}

export async function deleteClipFromStorage(urls: string[]): Promise<{ deleted: string[]; skipped: { url: string; reason: string }[] }> {
  const res = await fetch("/api/video/delete-clip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({}))).error ?? "delete failed");
  }
  return res.json();
}

export async function regenVideo(args: {
  language: Language;
  messageTheme: MessageTheme;
  angleKey: string;
  clipUrls: string[];
  voiceId?: string;
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
