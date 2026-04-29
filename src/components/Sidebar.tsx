"use client";

import { useEffect } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  CONTENT_TYPE_LABELS,
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  type ContentType,
  type Format,
  type Language,
} from "@/lib/types";

const FORMATS: Format[] = ["static", "video"];
const LANGS: Language[] = ["en", "tl", "es", "zh"];
const CONTENT_TYPES: ContentType[] = [
  "zero_down_generic",
  "edu_zero_down_usda_local",
  "edu_dpa_local",
  "language_match",
  "good_agents",
];

// Content types that don't make sense in certain languages.
function visibleContentTypes(language: Language): ContentType[] {
  if (language === "en") {
    // Native English audience doesn't need a "match an agent who speaks your language" pitch.
    return CONTENT_TYPES.filter((c) => c !== "language_match");
  }
  return CONTENT_TYPES;
}

export function Sidebar() {
  const { format, language, contentType, setFormat, setLanguage, setContentType } =
    useBatchStore();

  // If the user picks English while the hidden language_match type was selected,
  // bounce them back to the default so we never have an invisible-but-active
  // content type.
  useEffect(() => {
    const allowed = visibleContentTypes(language);
    if (!allowed.includes(contentType)) {
      setContentType(allowed[0]);
    }
  }, [language, contentType, setContentType]);

  const contentTypes = visibleContentTypes(language);
  const aspectBadge = format === "video" ? "9:16" : "4:5";

  return (
    <aside className="w-80 shrink-0 border-r border-neutral-200 dark:border-neutral-900 bg-white dark:bg-neutral-950 px-7 py-8 flex flex-col gap-8 h-screen overflow-y-auto">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Content Studio</h1>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Real estate · {format === "video" ? "short-form video" : "static posts"}
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.16em] text-neutral-400 dark:text-neutral-600 font-semibold">
          {aspectBadge}
        </span>
      </header>

      <div className="h-px bg-neutral-100 dark:bg-neutral-900" />

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
            <Pill selected>Narration · footage</Pill>
            <Pill muted>Vlogger · split-screen · soon</Pill>
          </div>
        </Section>
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

      <Section title="Content type">
        <div className="flex flex-col gap-2">
          {contentTypes.map((c) => (
            <Pill
              key={c}
              selected={contentType === c}
              onClick={() => setContentType(c)}
              align="left"
            >
              {CONTENT_TYPE_LABELS[c]}
            </Pill>
          ))}
        </div>
      </Section>
    </aside>
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
  const base = `w-full px-3.5 py-2.5 rounded-2xl text-[13px] border transition leading-snug ${
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
