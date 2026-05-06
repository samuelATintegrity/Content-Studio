"use client";

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  MESSAGE_THEME_LABELS,
  STATIC_CONTENT_TYPE_LABELS,
  type ContentType,
  type Format,
  type Language,
  type MessageTheme,
  type StaticContentType,
} from "@/lib/types";
import {
  deleteSavedSet,
  listSavedSets,
  subscribeSavedSets,
  type SavedSet,
} from "@/lib/savedSets";
import { useSavedSet } from "@/lib/generateVideo";
import { avatarsForLanguage } from "@/lib/avatars";
import { MusicLibraryModal } from "./MusicLibraryModal";
import {
  listMusicTracks,
  subscribeMusicLibrary,
} from "@/lib/musicLibrary";
import { BufferQueueModal } from "./BufferQueueModal";

const FORMATS: Format[] = ["static", "video"];
const LANGS: Language[] = ["en", "tl", "es", "zh"];
const CONTENT_TYPES: ContentType[] = [
  "zero_down_generic",
  "edu_zero_down_usda_local",
  "edu_dpa_local",
  "language_match",
  "good_agents",
];

const MESSAGE_THEMES: MessageTheme[] = ["agent_match", "dpa"];

// Static-format options: a single picker that combines the old
// Photo/Graphic toggle with the graphic-template picker. "photo" runs
// the blended-content-type photo flow (12 cards across 4 topics);
// each other value dispatches to its corresponding graphic template.
const STATIC_CONTENT_TYPES: StaticContentType[] = [
  "photo",
  "stat",
  "did_you_know",
  "promo",
  "ai_poster",
];

// Content types that don't make sense in certain (language, format)
// combinations. Used by the VIDEO content-type picker only — the
// static UI no longer surfaces individual content types (Photo runs
// a blended batch; the four graphic templates have their own pools).
// English skips language_match (the audience already speaks the
// agents' language). Video skips zero_down_generic — those generic
// narrations end up educating about the same programs that the USDA
// / DPA content types cover more crisply.
function visibleContentTypes(language: Language, format: Format): ContentType[] {
  let allowed = CONTENT_TYPES.slice();
  if (language === "en") {
    allowed = allowed.filter((c) => c !== "language_match");
  }
  if (format === "video") {
    allowed = allowed.filter((c) => c !== "zero_down_generic");
  }
  return allowed;
}

// Sidebar is the persistent picker on desktop and a slide-out drawer on
// mobile. The page passes drawerOpen + onClose so the parent can render
// a backdrop behind it; on lg+ those props are ignored (desktop sidebar
// is always visible inline).
interface SidebarProps {
  drawerOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ drawerOpen = false, onClose }: SidebarProps = {}) {
  const {
    format,
    language,
    contentType,
    subMode,
    staticContentType,
    selectedAvatarName,
    selectedMessageTheme,
    setFormat,
    setLanguage,
    setContentType,
    setSubMode,
    setStaticContentType,
    setSelectedAvatarName,
    setSelectedMessageTheme,
  } = useBatchStore();

  // Esc closes the mobile drawer. No-op on desktop since onClose is a
  // no-op prop.
  useEffect(() => {
    if (!drawerOpen || !onClose) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, onClose]);

  // The video flow is the only one that still surfaces a per-topic
  // ContentType picker. If the user's current content type becomes
  // invisible after a language or format swap (e.g. switching to
  // video when zero_down_generic was selected), bounce them to the
  // first allowed option so we never have an invisible-but-active
  // content type. Static no longer reads contentType from the store.
  useEffect(() => {
    if (format !== "video") return;
    const allowed = visibleContentTypes(language, format);
    if (!allowed.includes(contentType)) {
      setContentType(allowed[0]);
    }
  }, [language, format, contentType, setContentType]);

  const aspectBadge = format === "video" ? "9:16" : "4:5";

  return (
    <>
      {/* Backdrop — only on mobile when the drawer is open. Tap to close. */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-80 shrink-0 border-r border-neutral-200 dark:border-neutral-900 bg-white dark:bg-neutral-950 px-7 py-8 flex flex-col gap-8 h-screen overflow-y-auto transform transition-transform duration-200 lg:relative lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        aria-hidden={!drawerOpen ? undefined : false}
      >
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight">Content Studio</h1>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              Real estate · {format === "video" ? "short-form video" : "static posts"}
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-600 font-semibold">
            {aspectBadge}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="lg:hidden -mr-2 p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </header>

      <div className="h-px bg-neutral-100 dark:bg-neutral-900" />

      {/* Scheduled-posts review lives at the top so the user can
          glance at what's queued in Buffer regardless of which
          format/template they're currently working in. */}
      <ScheduledPostsSection />

      <Section title="Format">
        <div className="grid grid-cols-2 gap-2">
          {FORMATS.map((f) => (
            <Pill key={f} selected={format === f} onClick={() => setFormat(f)}>
              {FORMAT_LABELS[f]}
            </Pill>
          ))}
        </div>
      </Section>

      {format === "video" && (
        <Section title="Sub-mode">
          <div className="flex flex-col gap-2">
            <Pill
              selected={subMode === "narration"}
              onClick={() => setSubMode("narration")}
            >
              Narration · footage
            </Pill>
            <Pill
              selected={subMode === "influencer"}
              onClick={() => setSubMode("influencer")}
            >
              Influencer
            </Pill>
            <Pill
              selected={subMode === "funny_commercial"}
              onClick={() => setSubMode("funny_commercial")}
            >
              Funny commercial
            </Pill>
          </div>
        </Section>
      )}

      {format === "video" && subMode === "influencer" && (
        <AvatarSection
          language={language}
          selectedAvatarName={selectedAvatarName}
          onPick={setSelectedAvatarName}
        />
      )}

      {format === "video" && subMode === "narration" && <SavedSetsSection />}

      {format === "video" && subMode !== "funny_commercial" && (
        <MusicLibrarySection />
      )}

      <Section title="Language">
        <div className="grid grid-cols-2 gap-2">
          {LANGS.map((l) => (
            <Pill key={l} selected={language === l} onClick={() => setLanguage(l)}>
              {LANGUAGE_LABELS[l]}
            </Pill>
          ))}
        </div>
      </Section>

      {/* Video mode (narration + influencer) uses the Message theme
          picker. Funny commercial doesn't — its messaging is encoded
          in the chosen Scene 3 CTA. Static mode uses a single 5-pill
          content-type picker (Photo + the four graphic templates). */}
      {format === "video" && subMode !== "funny_commercial" ? (
        <Section title="Message">
          <div className="flex flex-col gap-2">
            {MESSAGE_THEMES.map((t) => (
              <Pill
                key={t}
                selected={selectedMessageTheme === t}
                onClick={() => setSelectedMessageTheme(t)}
                align="left"
              >
                {MESSAGE_THEME_LABELS[t]}
              </Pill>
            ))}
          </div>
        </Section>
      ) : format === "video" ? null : (
        // Static format — single picker. "Photo" runs the blended-
        // content-type 12-card flow; the four graphic templates each
        // dispatch to their existing per-template generator.
        <Section title="Content type">
          <div className="flex flex-col gap-2">
            {STATIC_CONTENT_TYPES.map((t) => (
              <Pill
                key={t}
                selected={staticContentType === t}
                onClick={() => setStaticContentType(t)}
                align="left"
              >
                {STATIC_CONTENT_TYPE_LABELS[t]}
              </Pill>
            ))}
          </div>
        </Section>
      )}
      </aside>
    </>
  );
}

function AvatarSection({
  language,
  selectedAvatarName,
  onPick,
}: {
  language: Language;
  selectedAvatarName: string | null;
  onPick: (name: string | null) => void;
}) {
  const avatars = avatarsForLanguage(language);
  if (avatars.length === 0) {
    return (
      <Section title="Avatar">
        <p className="text-[11px] text-neutral-500 leading-snug">
          No avatars available in {LANGUAGE_LABELS[language]}. Add one to
          <code className="mx-1 text-neutral-700 dark:text-neutral-300">
            src/lib/avatars.ts
          </code>
          with this language in <code>supportedLanguages</code>.
        </p>
      </Section>
    );
  }
  return (
    <Section title="Avatar">
      <div className="flex flex-col gap-2">
        {avatars.map((a) => {
          const isSelected = selectedAvatarName === a.name;
          return (
            <button
              key={a.name}
              onClick={() => onPick(isSelected ? null : a.name)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-2xl text-[13px] border transition leading-snug text-left ${
                isSelected
                  ? "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100"
                  : "bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
            >
              {a.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={a.imageUrl}
                  alt=""
                  className="w-9 h-9 rounded-full object-cover bg-neutral-200 dark:bg-neutral-800 shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-neutral-200 dark:bg-neutral-800 shrink-0" />
              )}
              <span className="font-medium">{a.name}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function SavedSetsSection() {
  const [sets, setSets] = useState<SavedSet[]>(() => listSavedSets());
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeSavedSets(() => setSets(listSavedSets()));
  }, []);

  if (sets.length === 0) {
    return (
      <Section title="Saved sets">
        <p className="text-[11px] text-neutral-500 leading-snug">
          Save an image set after a batch finishes to reuse it later without paying for another round of image + video generation.
        </p>
      </Section>
    );
  }

  async function onLoad(set: SavedSet) {
    if (loadingId) return;
    setLoadingId(set.id);
    try {
      await useSavedSet(set);
    } finally {
      setLoadingId(null);
    }
  }

  function onDelete(set: SavedSet) {
    if (!window.confirm(`Delete saved set "${set.name}"?`)) return;
    deleteSavedSet(set.id);
  }

  return (
    <Section title="Saved sets">
      <div className="flex flex-col gap-1.5">
        {sets.map((set) => (
          <div
            key={set.id}
            className="group flex items-center gap-2 px-3 py-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
          >
            <button
              onClick={() => onLoad(set)}
              disabled={loadingId !== null}
              className="flex-1 text-left min-w-0 disabled:opacity-60"
            >
              <div className="text-[12px] font-medium truncate">{set.name}</div>
              <div className="text-[10px] text-neutral-500 truncate">
                {new Date(set.savedAt).toLocaleDateString()} · {set.slots.length} clips
              </div>
            </button>
            <button
              onClick={() => onDelete(set)}
              className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition text-neutral-400 hover:text-red-500"
              title="Delete"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </Section>
  );
}

function MusicLibrarySection() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState<number>(() => listMusicTracks().length);
  useEffect(
    () => subscribeMusicLibrary(() => setCount(listMusicTracks().length)),
    [],
  );
  return (
    <Section title="Music">
      <button
        onClick={() => setOpen(true)}
        className="w-full px-3 py-2 rounded-2xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition flex items-center justify-between"
      >
        <span className="font-medium">Manage tracks</span>
        <span className="text-[11px] text-neutral-500 tabular-nums">
          {count} {count === 1 ? "track" : "tracks"}
        </span>
      </button>
      {open && <MusicLibraryModal onClose={() => setOpen(false)} />}
    </Section>
  );
}

function ScheduledPostsSection() {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Schedule">
      <button
        onClick={() => setOpen(true)}
        className="w-full px-3 py-2 rounded-2xl text-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition flex items-center justify-between"
      >
        <span className="font-medium">Scheduled posts</span>
        <span className="text-[11px] text-neutral-500">Buffer →</span>
      </button>
      {open && <BufferQueueModal onClose={() => setOpen(false)} />}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[10px] uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-500 font-semibold">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Pill({
  children,
  selected,
  muted,
  align = "center",
  onClick,
}: {
  children: React.ReactNode;
  selected?: boolean;
  muted?: boolean;
  align?: "left" | "center";
  onClick?: () => void;
}) {
  const base = `w-full px-3.5 py-3 lg:py-2.5 rounded-2xl text-[13px] border transition leading-snug ${
    align === "left" ? "text-left" : "text-center"
  }`;
  const variant = selected
    ? "bg-neutral-900 text-white border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100"
    : muted
      ? "bg-neutral-100 dark:bg-neutral-900 text-neutral-400 dark:text-neutral-600 border-transparent cursor-not-allowed"
      : "bg-white dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900";
  return (
    <button
      onClick={onClick}
      disabled={muted}
      className={`${base} ${variant}`}
    >
      {children}
    </button>
  );
}
