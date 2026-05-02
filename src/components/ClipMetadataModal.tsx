"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  updateLibraryClip,
  type ClipLanguage,
  type ClipRole,
  type LibraryClip,
} from "@/lib/clipLibrary";
import { AVATARS } from "@/lib/avatars";
import { MESSAGE_THEME_LABELS, type MessageTheme } from "@/lib/types";

// Same six categories the picker groups by — the modal exposes them as
// quick-toggle chips so users can always slot a clip into the right
// section even when the vision-tag pass put it in "Other".
const CATEGORIES: { key: string; label: string }[] = [
  { key: "kitchen",      label: "Kitchen" },
  { key: "bedroom",      label: "Bedroom" },
  { key: "bathroom",     label: "Bathroom" },
  { key: "exterior",     label: "Exterior" },
  { key: "agent",        label: "Agent" },
  { key: "loan_officer", label: "Loan Officer" },
];
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

const LANGUAGES: { key: ClipLanguage; label: string }[] = [
  { key: "en",    label: "English" },
  { key: "tl",    label: "Tagalog" },
  { key: "es",    label: "Spanish" },
  { key: "zh",    label: "Mandarin" },
  { key: "multi", label: "Multilingual" },
];

function normalizeTag(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

type RoleSelection = "filler" | ClipRole;

interface InitialClip {
  libraryClipId: string;
  // Optional preview surfaces — modal renders whichever is available.
  videoUrl?: string;
  posterUrl?: string;
  filename?: string;
  language?: ClipLanguage;
  tags?: string[];
  role?: ClipRole;
  avatarName?: string;
  messageTheme?: MessageTheme;
  captionCutoffPhrase?: string;
}

const MESSAGE_THEMES: MessageTheme[] = ["agent_match", "dpa"];

export function ClipMetadataModal({
  clip,
  title = "Edit clip details",
  onClose,
}: {
  clip: InitialClip;
  title?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(clip.filename ?? "");
  const [language, setLanguage] = useState<ClipLanguage>(clip.language ?? "multi");
  const [tags, setTags] = useState<string[]>(clip.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [role, setRole] = useState<RoleSelection>(clip.role ?? "filler");
  const [avatarName, setAvatarName] = useState<string>(clip.avatarName ?? "");
  // Default existing intro/outro clips to "agent_match" so the pre-DPA
  // library keeps working without a manual re-tag pass.
  const [messageTheme, setMessageTheme] = useState<MessageTheme>(
    clip.messageTheme ?? "agent_match",
  );
  const [captionCutoffPhrase, setCaptionCutoffPhrase] = useState<string>(
    clip.captionCutoffPhrase ?? "",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Esc closes; nothing async runs in this modal so always allow close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Split tags into the six "category" chips and everything else.
  const { selectedCategories, otherTags } = useMemo(() => {
    const cats = new Set<string>();
    const others: string[] = [];
    for (const t of tags) {
      if (CATEGORY_KEYS.has(t)) cats.add(t);
      else others.push(t);
    }
    return { selectedCategories: cats, otherTags: others };
  }, [tags]);

  function toggleCategory(cat: string) {
    setTags((prev) => {
      if (prev.includes(cat)) return prev.filter((t) => t !== cat);
      return [...prev, cat];
    });
  }

  function addTag() {
    const norm = normalizeTag(tagInput);
    if (!norm) return;
    setTags((prev) => (prev.includes(norm) ? prev : [...prev, norm]));
    setTagInput("");
    inputRef.current?.focus();
  }

  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  function onSave() {
    // Role + avatar are only persisted when role is intro/outro AND an
    // avatar is picked. Filler clears both fields so a clip can be moved
    // back into the general filler pool.
    const persistedRole = role === "filler" ? undefined : role;
    const persistedAvatar = persistedRole && avatarName ? avatarName : undefined;
    const persistedTheme = persistedRole ? messageTheme : undefined;
    const persistedCutoff =
      persistedRole && captionCutoffPhrase.trim()
        ? captionCutoffPhrase.trim()
        : undefined;
    updateLibraryClip(clip.libraryClipId, {
      filename: name.trim() || undefined,
      language,
      tags,
      role: persistedRole,
      avatarName: persistedAvatar,
      messageTheme: persistedTheme,
      captionCutoffPhrase: persistedCutoff,
    });
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-white dark:bg-neutral-950 rounded-3xl border border-neutral-200 dark:border-neutral-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <header className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-900 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
            aria-label="Close"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="p-6 flex flex-col gap-5 overflow-y-auto">
          {/* Preview thumbnail (small). */}
          {(clip.videoUrl || clip.posterUrl) && (
            <div className="rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-900 aspect-[9/16] max-h-[180px] mx-auto bg-neutral-100 dark:bg-neutral-900">
              {clip.videoUrl ? (
                <video
                  src={clip.videoUrl}
                  poster={clip.posterUrl}
                  muted
                  playsInline
                  preload="metadata"
                  className="w-full h-full object-cover"
                />
              ) : clip.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={clip.posterUrl} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A short label so you can find it later"
              className="px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              Language
            </span>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGES.map((l) => (
                <button
                  key={l.key}
                  onClick={() => setLanguage(l.key)}
                  className={`text-[11px] px-2.5 py-1.5 rounded-full border transition ${
                    language === l.key
                      ? "bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white text-white dark:text-neutral-900 font-semibold"
                      : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              Category <span className="font-normal text-neutral-400">(pick any that fit)</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => {
                const active = selectedCategories.has(c.key);
                return (
                  <button
                    key={c.key}
                    onClick={() => toggleCategory(c.key)}
                    className={`text-[11px] px-2.5 py-1.5 rounded-full border transition ${
                      active
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Influencer-mode: Role pills (filler / intro / outro). Filler is
              the default and matches existing library behavior. Intro/outro
              dedicate the clip to a specific avatar's bookend library. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              Role <span className="font-normal text-neutral-400">(influencer mode)</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(["filler", "intro", "outro"] as RoleSelection[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`text-[11px] px-2.5 py-1.5 rounded-full border transition capitalize ${
                    role === r
                      ? "bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white text-white dark:text-neutral-900 font-semibold"
                      : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {role !== "filler" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Avatar
              </span>
              {AVATARS.length === 0 ? (
                <p className="text-[11px] text-neutral-400">
                  No avatars configured yet. Edit <code>src/lib/avatars.ts</code> to add one.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {AVATARS.map((a) => (
                    <button
                      key={a.name}
                      onClick={() => setAvatarName(a.name)}
                      className={`text-[11px] px-2.5 py-1.5 rounded-full border transition ${
                        avatarName === a.name
                          ? "bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white text-white dark:text-neutral-900 font-semibold"
                          : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {role !== "filler" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Message theme
              </span>
              <div className="flex flex-wrap gap-1.5">
                {MESSAGE_THEMES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setMessageTheme(t)}
                    className={`text-[11px] px-2.5 py-1.5 rounded-full border transition ${
                      messageTheme === t
                        ? "bg-neutral-900 dark:bg-white border-neutral-900 dark:border-white text-white dark:text-neutral-900 font-semibold"
                        : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {MESSAGE_THEME_LABELS[t]}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-neutral-500 leading-snug">
                Which scripted topic this bookend was recorded for. Each theme
                has its own intro/outro library in the picker.
              </span>
            </div>
          )}

          {role !== "filler" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
                Caption cutoff phrase{" "}
                <span className="font-normal text-neutral-400 normal-case tracking-normal">
                  (optional — captions stop when this phrase is spoken)
                </span>
              </span>
              <input
                type="text"
                value={captionCutoffPhrase}
                onChange={(e) => setCaptionCutoffPhrase(e.target.value)}
                placeholder='e.g. "check out" — drops captions for that phrase and everything after'
                className="px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
              />
              <span className="text-[10px] text-neutral-500 leading-snug">
                Useful for clean-canvas moments — e.g. when a brand mention will
                be covered by a title-card overlay in post.
              </span>
            </label>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              Other tags
            </span>
            <div className="flex flex-wrap gap-1.5">
              {otherTags.length === 0 && (
                <span className="text-[11px] text-neutral-400">No other tags yet.</span>
              )}
              {otherTags.map((t) => (
                <span
                  key={t}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 inline-flex items-center gap-1.5"
                >
                  {t.replace(/_/g, " ")}
                  <button
                    onClick={() => removeTag(t)}
                    className="text-neutral-400 hover:text-red-500"
                    aria-label={`Remove ${t}`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag (e.g. couple, keys, modern)…"
                className="flex-1 px-3 py-1.5 rounded-full text-[12px] bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
              />
              <button
                onClick={addTag}
                disabled={!tagInput.trim()}
                className="px-3 py-1.5 rounded-full text-[12px] font-semibold bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-900 dark:text-neutral-100 disabled:opacity-40 transition"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <footer className="px-6 py-4 border-t border-neutral-200 dark:border-neutral-900 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-900 dark:text-neutral-100 transition"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="px-4 py-2 rounded-full text-[12px] font-semibold bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 transition"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

// Convenience overload for opening the modal seeded from a stored
// LibraryClip. Components can pass either the persisted record or a
// freshly-built sketch (e.g., the AI clip modal pre-saving).
export function libraryClipToInitial(c: LibraryClip): InitialClip {
  return {
    libraryClipId: c.id,
    videoUrl: c.url,
    posterUrl: c.posterUrl,
    filename: c.filename,
    language: c.language,
    tags: c.tags,
    role: c.role,
    avatarName: c.avatarName,
    messageTheme: c.messageTheme,
    captionCutoffPhrase: c.captionCutoffPhrase,
  };
}
