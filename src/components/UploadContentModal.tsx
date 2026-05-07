"use client";

import { useEffect, useRef, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import { BufferSendModal } from "./BufferSendModal";
import {
  CONTENT_TYPE_LABELS,
  LANGUAGE_LABELS,
  type ContentType,
  type Language,
} from "@/lib/types";

// Upload Content modal — five-step wizard:
//   1. Pick file (video or image; MIME auto-detects)
//   2. Confirm language + content type (defaults pulled from sidebar
//      state but overridable per upload)
//   3. Click Generate caption → uploads to R2 → transcribes / describes
//      → drafts caption body via Claude
//   4. Edit the full caption inline
//   5. Click Send to Buffer → opens the existing BufferSendModal
//
// All async work is sequential; errors at any step bounce the user
// back to the prior good state with a red error line. No persistence —
// once the post lands in Buffer it shows up in the BufferQueueModal
// like every other scheduled card.

const CONTENT_TYPE_OPTIONS: ContentType[] = [
  "zero_down_generic",
  "edu_zero_down_usda_local",
  "edu_dpa_local",
  "edu_physician_loans",
  "edu_hero_loans",
  "language_match",
  "good_agents",
];

const LANGUAGE_OPTIONS: Language[] = ["en", "tl", "es", "zh"];

type Phase =
  | "idle"           // file not picked yet
  | "uploading"      // mirroring to R2
  | "extracting"    // Whisper / Vision pulling source text
  | "drafting"       // Claude writing the caption body
  | "ready"          // caption ready for review + edit
  | "sending";       // BufferSendModal open

interface Props {
  onClose: () => void;
}

interface UploadResult {
  url: string;
  filename: string;
  kind: "video" | "image";
}

export function UploadContentModal({ onClose }: Props) {
  // Pull defaults from sidebar state, but track them locally so the
  // modal-level pickers don't ripple back into the global flow.
  const globalLanguage = useBatchStore((s) => s.language);
  const globalContentType = useBatchStore((s) => s.contentType);

  const [language, setLanguage] = useState<Language>(globalLanguage);
  const [contentType, setContentType] = useState<ContentType>(globalContentType);

  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadResult | null>(null);
  const [sourceText, setSourceText] = useState<string>("");
  const [caption, setCaption] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Esc to close (when not mid-upload or mid-send).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (phase === "uploading" || phase === "extracting" || phase === "drafting") return;
      if (phase === "sending") return; // BufferSendModal owns Esc when it's open
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setFile(f);
    // Reset downstream state when the file changes — prevents a stale
    // caption from a prior upload bleeding into the next one.
    setUploaded(null);
    setSourceText("");
    setCaption("");
    setPhase("idle");
  }

  function fileKind(f: File): "video" | "image" | null {
    if (f.type.startsWith("video/")) return "video";
    if (f.type.startsWith("image/")) return "image";
    // Fall back to extension if the browser didn't set a type
    const lower = f.name.toLowerCase();
    if (/\.(mp4|mov|m4v|webm|avi)$/.test(lower)) return "video";
    if (/\.(png|jpe?g|webp|gif)$/.test(lower)) return "image";
    return null;
  }

  // Compute the SHA-256 hex digest of the file's bytes, browser-side.
  // We use the first 32 hex chars of the digest as the R2 key prefix,
  // which mirrors the old server-side upload routes — same file twice
  // is the same R2 object.
  async function sha256Hex(f: File): Promise<string> {
    const buf = await f.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, "0");
    }
    return hex.slice(0, 32);
  }

  // Pick a usable Content-Type + extension for the PUT. Browsers
  // sometimes hand us empty strings for both, especially when the
  // file came from drag-drop on Safari, so we fall back to a generic
  // mp4/png. R2 will validate the signed Content-Type against what
  // the browser sends in the PUT, so the two MUST match — that's
  // why we resolve them once here and pass them to both calls.
  function resolveTypeAndExt(f: File, kind: "video" | "image"): {
    contentType: string;
    ext: string;
  } {
    const lower = f.name.toLowerCase();
    const extMatch = lower.match(/\.([a-z0-9]+)$/);
    let ext = extMatch?.[1] ?? "";
    let contentType = f.type;
    if (kind === "video") {
      if (!ext || !["mp4", "mov", "m4v", "webm", "avi"].includes(ext)) ext = "mp4";
      if (!contentType) contentType = ext === "webm" ? "video/webm" : "video/mp4";
    } else {
      if (!ext || !["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) ext = "png";
      if (!contentType) {
        contentType =
          ext === "jpg" || ext === "jpeg"
            ? "image/jpeg"
            : ext === "webp"
              ? "image/webp"
              : ext === "gif"
                ? "image/gif"
                : "image/png";
      }
    }
    return { contentType, ext };
  }

  // Direct-to-R2 upload via a signed PUT URL. Bypasses Vercel's
  // ~4.5MB serverless body limit entirely — the file goes browser →
  // R2, the serverless function only signs the URL.
  async function uploadFile(f: File, kind: "video" | "image"): Promise<UploadResult> {
    const { contentType, ext } = resolveTypeAndExt(f, kind);
    const sha = await sha256Hex(f);

    // 1. Ask the server for a signed URL.
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, contentType, sha, ext }),
    });
    const presignText = await presignRes.text();
    let presign: { uploadUrl?: string; publicUrl?: string; error?: string } = {};
    try {
      presign = presignText ? JSON.parse(presignText) : {};
    } catch {
      throw new Error(`presign returned non-JSON (${presignRes.status})`);
    }
    if (!presignRes.ok) {
      throw new Error(presign.error ?? `presign failed (${presignRes.status})`);
    }
    if (!presign.uploadUrl || !presign.publicUrl) {
      throw new Error("presign returned malformed body");
    }

    // 2. PUT the bytes straight at R2. Content-Type MUST match the
    //    one we asked the server to sign for, or R2 rejects with 403.
    const putRes = await fetch(presign.uploadUrl, {
      method: "PUT",
      headers: { "content-type": contentType },
      body: f,
    });
    if (!putRes.ok) {
      const detail = await putRes.text().catch(() => "");
      throw new Error(`R2 upload failed (${putRes.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    return { url: presign.publicUrl, filename: f.name, kind };
  }

  async function extractSource(up: UploadResult): Promise<string> {
    if (up.kind === "video") {
      const res = await fetch("/api/upload/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: up.url, language }),
      });
      const json = (await res.json().catch(() => ({}))) as { transcript?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `transcribe failed (${res.status})`);
      if (!json.transcript) throw new Error("transcript was empty");
      return json.transcript;
    }
    // image
    const res = await fetch("/api/upload/describe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: up.url }),
    });
    const json = (await res.json().catch(() => ({}))) as { description?: string; error?: string };
    if (!res.ok) throw new Error(json.error ?? `describe failed (${res.status})`);
    if (!json.description) throw new Error("description was empty");
    return json.description;
  }

  async function draftCaption(source: string, kind: "video" | "image"): Promise<string> {
    const res = await fetch("/api/upload/draft-caption", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        sourceKind: kind,
        language,
        contentType,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { caption?: string; error?: string };
    if (!res.ok) throw new Error(json.error ?? `draft-caption failed (${res.status})`);
    if (!json.caption) throw new Error("caption draft was empty");
    return json.caption;
  }

  // The orchestrator. Walks all three steps in sequence, surfacing
  // each phase to the UI. Errors at any step return the user to the
  // previous good state with a message — they can adjust and retry.
  async function generateCaption() {
    if (!file) return;
    const kind = fileKind(file);
    if (!kind) {
      setError("Unsupported file type. Use a video (mp4/mov/webm) or image (png/jpg/webp).");
      return;
    }
    setError(null);
    try {
      // Step 1: upload to R2 (skip if we already have an upload for
      // this exact file — re-running with the same file just regens
      // the caption from the existing R2 URL).
      let up = uploaded;
      if (!up || up.filename !== file.name) {
        setPhase("uploading");
        up = await uploadFile(file, kind);
        setUploaded(up);
      }

      // Step 2: pull source text (transcribe or describe).
      setPhase("extracting");
      const source = await extractSource(up);
      setSourceText(source);

      // Step 3: draft the caption body.
      setPhase("drafting");
      const drafted = await draftCaption(source, kind);
      setCaption(drafted);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "generation failed");
      // Fall back to whichever state has data:
      //   - if we never uploaded, back to idle
      //   - if we uploaded but extraction failed, stay at idle so user
      //     can retry "Generate caption" without re-uploading
      //   - if extraction succeeded but drafting failed, surface "ready"
      //     with the source text so user can see what's there
      setPhase(uploaded ? "ready" : "idle");
    }
  }

  // Re-draft the caption using the existing source text. Lets the
  // user swap content-type / language and get a fresh body without
  // paying for another Whisper / Vision call.
  async function redraftOnly() {
    if (!sourceText || !uploaded) return;
    setError(null);
    setPhase("drafting");
    try {
      const drafted = await draftCaption(sourceText, uploaded.kind);
      setCaption(drafted);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "redraft failed");
      setPhase("ready");
    }
  }

  function onBufferSent() {
    // BufferSendModal handles its own success UI. We just close the
    // upload modal so the user lands back on whatever they were doing
    // (and BufferQueueModal will surface the new pending post).
    setPhase("ready");
    onClose();
  }

  const canGenerate = file !== null && phase !== "uploading" && phase !== "extracting" && phase !== "drafting";
  const busyLabel =
    phase === "uploading"
      ? "Uploading…"
      : phase === "extracting"
        ? uploaded?.kind === "video"
          ? "Transcribing with Whisper…"
          : "Reading the image with Claude Vision…"
        : phase === "drafting"
          ? "Drafting caption…"
          : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/55 flex items-start justify-center overflow-y-auto py-10 px-4">
        <div className="w-full max-w-2xl bg-white dark:bg-neutral-950 rounded-3xl border border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col">
          <header className="flex items-start justify-between gap-4 px-6 py-5 border-b border-neutral-100 dark:border-neutral-900">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Upload content
              </span>
              <h2 className="text-base font-semibold tracking-tight">
                Push your own video or photo to Buffer
              </h2>
              <p className="text-[11px] text-neutral-500 leading-snug">
                We&apos;ll transcribe (or describe), draft a caption with the language-matched
                link at the top, and let you edit before scheduling.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] font-medium px-3 py-1.5 rounded-full text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Close
            </button>
          </header>

          <div className="flex flex-col gap-5 px-6 py-5">
            {/* Step 1: file picker */}
            <section className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
                File
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={phase === "uploading" || phase === "extracting" || phase === "drafting"}
                  className="px-4 py-2 rounded-full text-[12px] font-semibold border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
                >
                  {file ? "Change file" : "Pick a file"}
                </button>
                {file && (
                  <span className="text-[12px] text-neutral-600 dark:text-neutral-400 truncate" title={file.name}>
                    {file.name}{" "}
                    <span className="text-[10px] text-neutral-500">
                      ({fileKind(file) ?? "?"} · {(file.size / (1024 * 1024)).toFixed(2)} MB)
                    </span>
                  </span>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/*"
                onChange={pickFile}
                className="hidden"
              />
              <p className="text-[10px] text-neutral-500 leading-snug">
                Video → Whisper transcribes it. Photo → Vision describes it. Either way, Claude
                drafts the caption next.
              </p>
            </section>

            {/* Step 2: language + content-type pickers */}
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className="px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
                >
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-500 leading-snug">
                  Drives both the link at the top of the caption and the Buffer channels we
                  fan out to.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
                  Content type
                </label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as ContentType)}
                  className="px-3 py-2 rounded-xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950"
                >
                  {CONTENT_TYPE_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {CONTENT_TYPE_LABELS[c]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-neutral-500 leading-snug">
                  Sets the caption&apos;s angle + the form line just under the link.
                </p>
              </div>
            </section>

            {error && (
              <p className="text-[12px] text-red-500 leading-snug">{error}</p>
            )}

            {/* Step 3 trigger */}
            {phase !== "ready" && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={generateCaption}
                  disabled={!canGenerate}
                  className="px-5 py-2.5 rounded-full text-[13px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-50"
                >
                  {busyLabel ?? "Generate caption"}
                </button>
                {busyLabel && (
                  <span className="text-[11px] text-neutral-500">
                    Hang tight — this can take 10-30s.
                  </span>
                )}
              </div>
            )}

            {/* Step 4: editable caption + redraft */}
            {phase === "ready" && (
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold">
                    Caption (edit freely)
                  </label>
                  <button
                    type="button"
                    onClick={redraftOnly}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    title="Re-write the caption body with current language + content type. Re-uses the existing transcript / description so it's free."
                  >
                    Re-draft body
                  </button>
                </div>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 rounded-xl text-[12px] leading-relaxed border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 resize-y font-mono"
                />
                <details className="text-[11px] text-neutral-500">
                  <summary className="cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100">
                    Source text used for the draft
                  </summary>
                  <pre className="mt-2 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 text-[11px] leading-relaxed whitespace-pre-wrap font-sans">
                    {sourceText}
                  </pre>
                </details>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setPhase("sending")}
                    disabled={!uploaded || !caption.trim()}
                    className="px-5 py-2.5 rounded-full text-[13px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 disabled:opacity-50"
                  >
                    Send to Buffer
                  </button>
                  <button
                    type="button"
                    onClick={generateCaption}
                    disabled={phase !== "ready"}
                    className="px-4 py-2 rounded-full text-[12px] font-medium border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
                    title="Re-run the entire pipeline (re-transcribe / re-describe + re-draft). Useful if the transcript came out garbled."
                  >
                    Re-run from scratch
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Step 5: hand off to the existing Buffer modal */}
      {phase === "sending" && uploaded && caption.trim() && (
        <BufferSendModal
          language={language}
          videoUrl={uploaded.kind === "video" ? uploaded.url : undefined}
          imageUrl={uploaded.kind === "image" ? uploaded.url : undefined}
          caption={caption}
          onClose={() => setPhase("ready")}
          onSuccess={onBufferSent}
        />
      )}
    </>
  );
}
