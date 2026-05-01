"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useBatchStore } from "@/store/batchStore";
import {
  addLibraryClip,
  listMergedLibrary,
  removeLibraryClip,
  subscribeMergedLibrary,
  updateLibraryClip,
  type ClipLanguage,
  type MergedClip,
} from "@/lib/clipLibrary";
import { listSavedSets } from "@/lib/savedSets";
import { deleteClipFromStorage, tagClip, uploadClip } from "@/lib/videoClient";
import {
  INFLUENCER_MIDDLE_MAX,
  INFLUENCER_MIDDLE_MIN,
  PICKED_CLIP_COUNT,
} from "@/lib/videoPrompts";
import { AiClipModal } from "@/components/AiClipModal";
import { ClipMetadataModal } from "@/components/ClipMetadataModal";

// Six fixed category sections (matches the user's mental model: rooms +
// pro people). Anything not matching lands in an "Other" bucket.
type CategoryKey = "kitchen" | "bedroom" | "bathroom" | "exterior" | "agent" | "loan_officer";
const CATEGORY_ORDER: { key: CategoryKey; label: string; tag: string }[] = [
  { key: "kitchen",      label: "Kitchen",      tag: "kitchen" },
  { key: "bedroom",      label: "Bedroom",      tag: "bedroom" },
  { key: "bathroom",     label: "Bathroom",     tag: "bathroom" },
  { key: "exterior",     label: "Exterior",     tag: "exterior" },
  { key: "agent",        label: "Agent",        tag: "agent" },
  { key: "loan_officer", label: "Loan Officer", tag: "loan_officer" },
];

const LANGUAGE_ORDER: { key: ClipLanguage; label: string }[] = [
  { key: "en",    label: "English" },
  { key: "tl",    label: "Tagalog" },
  { key: "es",    label: "Spanish" },
  { key: "zh",    label: "Mandarin" },
  { key: "multi", label: "Multilingual" },
];

const LANGUAGE_SHORT: Record<ClipLanguage, string> = {
  en: "EN",
  tl: "TL",
  es: "ES",
  zh: "ZH",
  multi: "ALL",
};

type GroupBy = "none" | "category" | "language";

export function ClipLibraryGrid() {
  const [clips, setClips] = useState<MergedClip[]>(() => listMergedLibrary());
  const [filter, setFilter] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [aiModalOpen, setAiModalOpen] = useState(false);
  // When set, opens the metadata modal pre-seeded from this clip. Used
  // for the pencil-edit flow AND the auto-prompt after upload / AI clip
  // creation so the user can name + categorize the new clip immediately.
  const [editingClipKey, setEditingClipKey] = useState<string | null>(null);
  const selectedKeys = useBatchStore((s) => s.selectedClipKeys);
  const selectClip = useBatchStore((s) => s.selectClip);
  const deselectClip = useBatchStore((s) => s.deselectClip);
  const clearClipSelection = useBatchStore((s) => s.clearClipSelection);
  const subMode = useBatchStore((s) => s.subMode);
  const language = useBatchStore((s) => s.language);
  const selectedAvatarName = useBatchStore((s) => s.selectedAvatarName);
  const selectedIntroClipUrl = useBatchStore((s) => s.selectedIntroClipUrl);
  const selectedOutroClipUrl = useBatchStore((s) => s.selectedOutroClipUrl);
  const setSelectedIntroClipUrl = useBatchStore((s) => s.setSelectedIntroClipUrl);
  const setSelectedOutroClipUrl = useBatchStore((s) => s.setSelectedOutroClipUrl);
  const isInfluencer = subMode === "influencer";

  function onEdit(clip: MergedClip) {
    if (clip.kind === "saved") return; // managed via the Saved Sets sidebar
    const id = clip.origin.libraryClipId;
    if (!id) return;
    setEditingClipKey(id);
  }

  // Look up the LibraryClip-shaped values for the modal from our merged
  // list. We want the live values, so this re-derives from `clips` which
  // is already kept in sync via subscribeMergedLibrary.
  const editingMerged = editingClipKey
    ? clips.find((c) => c.origin.libraryClipId === editingClipKey)
    : null;

  async function onDelete(clip: MergedClip) {
    if (clip.kind === "saved") return; // saved-set clips are governed by sidebar
    const id = clip.origin.libraryClipId;
    if (!id) return;
    const label = clip.kind === "upload" ? clip.origin.filename ?? "this upload" : "this clip";

    // Check if any saved set references this video URL — deleting the file
    // from R2 would break those sets. The poster image is set-internal and
    // safe to delete (saved sets carry their own image URLs from R2 too,
    // but clip URL is the load-bearing one for selection).
    const conflictingSets = listSavedSets().filter((s) =>
      s.slots.some((slot) => slot.videoUrl === clip.videoUrl || slot.imageUrl === clip.posterUrl),
    );

    let warning = `Permanently delete ${label}?\n\nThis removes it from your library AND deletes the file from R2 storage.`;
    if (conflictingSets.length > 0) {
      const names = conflictingSets.map((s) => `"${s.name}"`).join(", ");
      warning += `\n\n⚠️ This file is also used by saved set${conflictingSets.length > 1 ? "s" : ""} ${names}. Deleting it will break ${conflictingSets.length > 1 ? "them" : "that set"}.`;
    }
    if (!window.confirm(warning)) return;

    if (selectedKeys.includes(clip.key)) deselectClip(clip.key);
    removeLibraryClip(id);

    const urls = [clip.videoUrl];
    if (clip.posterUrl) urls.push(clip.posterUrl);
    try {
      await deleteClipFromStorage(urls);
    } catch (err) {
      console.error("[clipLibrary] R2 delete failed", err);
      window.alert(`Removed from library, but storage delete failed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  useEffect(() => {
    return subscribeMergedLibrary(() => setClips(listMergedLibrary()));
  }, []);

  const selectedCount = selectedKeys.length;
  const middlePickCap = isInfluencer ? INFLUENCER_MIDDLE_MAX : PICKED_CLIP_COUNT;
  const atCap = selectedCount >= middlePickCap;

  // Build the union of all tags currently in the library, for the filter chips.
  const allTags: string[] = (() => {
    const set = new Set<string>();
    for (const c of clips) {
      if (c.tags) for (const t of c.tags) set.add(t);
    }
    return Array.from(set).sort();
  })();

  // Apply text + tag filters.
  const q = filter.trim().toLowerCase();
  const filteredClips = clips.filter((c) => {
    if (activeTags.size > 0) {
      const tags = c.tags ?? [];
      // AND across selected tag chips: a clip must have ALL selected tags.
      for (const t of activeTags) if (!tags.includes(t)) return false;
    }
    if (q) {
      const haystack = [
        ...(c.tags ?? []),
        c.origin.filename,
        c.origin.setName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Influencer-mode bookend pools, scoped to the active avatar + language.
  // Filtered from the full library (not the search-filtered list) so the
  // user always sees their available bookends regardless of text/tag filters.
  const matchesAvatarLanguage = (c: MergedClip): boolean => {
    if (!selectedAvatarName) return false;
    if (c.avatarName !== selectedAvatarName) return false;
    // Bookends must be language-specific — "multi" doesn't make sense for
    // a recorded avatar speaking a particular language.
    if (c.language !== language) return false;
    return true;
  };
  const introClips = isInfluencer
    ? clips.filter((c) => c.role === "intro" && matchesAvatarLanguage(c))
    : [];
  const outroClips = isInfluencer
    ? clips.filter((c) => c.role === "outro" && matchesAvatarLanguage(c))
    : [];

  // Influencer-mode middle picker: filler clips only (anything without an
  // intro/outro role). Bookends would visually clash with the avatar's
  // own intro/outro segments.
  const middleFiltered = isInfluencer
    ? filteredClips.filter((c) => !c.role)
    : filteredClips;

  function onChangeLanguage(clip: MergedClip, language: ClipLanguage) {
    if (clip.kind === "saved") return; // saved-set clips don't live in our index
    const id = clip.origin.libraryClipId;
    if (!id) return;
    updateLibraryClip(id, { language });
  }

  // Render one tile. Used both by the flat grid and by GroupedSections so
  // the per-tile contract (selection, delete, edit, language) is one piece.
  function renderTile(clip: MergedClip) {
    const idx = selectedKeys.indexOf(clip.key);
    const selected = idx >= 0;
    const handleClick = () => {
      // Influencer middle picker enforces its own cap (the store's hard cap
      // is PICKED_CLIP_COUNT, larger than the influencer max). Block adding
      // beyond INFLUENCER_MIDDLE_MAX; toggling-off an existing pick is fine.
      if (isInfluencer && !selected && selectedKeys.length >= INFLUENCER_MIDDLE_MAX) {
        return;
      }
      selectClip(clip.key, clip.videoUrl);
    };
    return (
      <ClipTile
        key={clip.key}
        clip={clip}
        selectionNumber={selected ? idx + 1 : null}
        dim={!selected && atCap}
        onClick={handleClick}
        onDelete={clip.kind === "saved" ? undefined : () => onDelete(clip)}
        onEdit={clip.kind === "saved" ? undefined : () => onEdit(clip)}
        onLanguageChange={
          clip.kind === "saved" ? undefined : (lang) => onChangeLanguage(clip, lang)
        }
      />
    );
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  return (
    <section className="mt-8">
      <header className="flex items-baseline justify-between mb-3 px-1">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">
          Clip library · {clips.length} {clips.length === 1 ? "clip" : "clips"}
        </h3>
        <div className="flex items-center gap-2">
          {!isInfluencer && selectedCount === PICKED_CLIP_COUNT && (
            <span className="text-[11px] font-semibold text-emerald-500 tabular-nums">
              {PICKED_CLIP_COUNT} / {PICKED_CLIP_COUNT} ready
            </span>
          )}
          {isInfluencer && selectedCount >= INFLUENCER_MIDDLE_MIN && (
            <span className="text-[11px] font-semibold text-emerald-500 tabular-nums">
              {selectedCount} / {INFLUENCER_MIDDLE_MAX} middle
            </span>
          )}
          {selectedCount > 0 && (
            <button
              onClick={clearClipSelection}
              className="text-[11px] px-2.5 py-1 rounded-full border border-neutral-300 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition"
            >
              Clear selection
            </button>
          )}
        </div>
      </header>

      {/* Search + tag-chip filter. Only render when there's anything to filter. */}
      {(clips.length > 0 || filter) && (
        <div className="mb-3 px-1 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search filenames, tags…"
              className="flex-1 min-w-[200px] sm:max-w-xs px-3 py-1.5 rounded-full text-[12px] bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
            />
            {/* Group-by segmented toggle */}
            <div className="inline-flex rounded-full border border-neutral-200 dark:border-neutral-800 overflow-hidden text-[11px]">
              {(["none", "category", "language"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  className={`px-3 py-1.5 transition ${
                    groupBy === g
                      ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold"
                      : "bg-transparent text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  }`}
                >
                  {g === "none" ? "Flat" : g === "category" ? "By category" : "By language"}
                </button>
              ))}
            </div>
          </div>
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => {
                const active = activeTags.has(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`text-[10px] px-2.5 py-1 rounded-full border transition tabular-nums ${
                      active
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    {tag.replace(/_/g, " ")}
                  </button>
                );
              })}
              {activeTags.size > 0 && (
                <button
                  onClick={() => setActiveTags(new Set())}
                  className="text-[10px] px-2.5 py-1 rounded-full text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition"
                >
                  Clear tags
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {isInfluencer && (
        <BookendZones
          avatarName={selectedAvatarName}
          introClips={introClips}
          outroClips={outroClips}
          selectedIntroUrl={selectedIntroClipUrl}
          selectedOutroUrl={selectedOutroClipUrl}
          onPickIntro={setSelectedIntroClipUrl}
          onPickOutro={setSelectedOutroClipUrl}
        />
      )}

      {isInfluencer && (
        <h4 className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold mb-2 px-1 mt-6">
          Middle filler ({INFLUENCER_MIDDLE_MIN}–{INFLUENCER_MIDDLE_MAX} clips)
        </h4>
      )}

      {groupBy === "none" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          <UploadTile onUploaded={(id) => setEditingClipKey(id)} />
          <AiClipTile onOpen={() => setAiModalOpen(true)} />
          {middleFiltered.map((clip) => renderTile(clip))}
        </div>
      ) : (
        <GroupedSections
          groupBy={groupBy}
          clips={middleFiltered}
          renderTile={renderTile}
          extraTiles={
            <>
              <UploadTile onUploaded={(id) => setEditingClipKey(id)} />
              <AiClipTile onOpen={() => setAiModalOpen(true)} />
            </>
          }
        />
      )}

      {clips.length === 0 && (
        <p className="mt-3 text-[11px] text-neutral-500 px-1">
          Your library will fill up automatically as you generate clips from scratch.
        </p>
      )}
      {clips.length > 0 && filteredClips.length === 0 && (
        <p className="mt-3 text-[11px] text-neutral-500 px-1">
          No clips match the current filter.
        </p>
      )}

      {aiModalOpen && (
        <AiClipModal
          onClose={() => setAiModalOpen(false)}
          onCreated={({ libraryClipId, videoUrl }) => {
            // Auto-select + auto-open the metadata modal so the user can
            // name + tag the new clip while it's fresh in mind.
            selectClip(libraryClipId, videoUrl);
            setEditingClipKey(libraryClipId);
          }}
        />
      )}

      {editingMerged && editingClipKey && (
        <ClipMetadataModal
          clip={{
            libraryClipId: editingClipKey,
            videoUrl: editingMerged.videoUrl,
            posterUrl: editingMerged.posterUrl,
            filename: editingMerged.origin.filename,
            language: editingMerged.language,
            tags: editingMerged.tags,
            role: editingMerged.role,
            avatarName: editingMerged.avatarName,
            captionCutoffPhrase: editingMerged.captionCutoffPhrase,
          }}
          onClose={() => setEditingClipKey(null)}
        />
      )}
    </section>
  );
}

// Influencer-mode intro/outro pickers. Each is a single-pick row showing
// only the active avatar + language's bookend clips. Clicking selects
// (and toggles off) the URL into the dedicated store slice.
function BookendZones({
  avatarName,
  introClips,
  outroClips,
  selectedIntroUrl,
  selectedOutroUrl,
  onPickIntro,
  onPickOutro,
}: {
  avatarName: string | null;
  introClips: MergedClip[];
  outroClips: MergedClip[];
  selectedIntroUrl: string | null;
  selectedOutroUrl: string | null;
  onPickIntro: (url: string | null) => void;
  onPickOutro: (url: string | null) => void;
}) {
  if (!avatarName) {
    return (
      <p className="text-[11px] text-neutral-500 px-1 py-3 leading-snug">
        Pick an avatar in the sidebar to load their intro and outro clips.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <BookendRow
        label="Intro"
        clips={introClips}
        selectedUrl={selectedIntroUrl}
        onPick={onPickIntro}
        emptyHint="No intros tagged for this avatar in this language. Upload an intro clip and edit its details to set Role=Intro and Avatar."
      />
      <BookendRow
        label="Outro"
        clips={outroClips}
        selectedUrl={selectedOutroUrl}
        onPick={onPickOutro}
        emptyHint="No outros tagged for this avatar in this language. Upload an outro clip and edit its details to set Role=Outro and Avatar."
      />
    </div>
  );
}

function BookendRow({
  label,
  clips,
  selectedUrl,
  onPick,
  emptyHint,
}: {
  label: string;
  clips: MergedClip[];
  selectedUrl: string | null;
  onPick: (url: string | null) => void;
  emptyHint: string;
}) {
  return (
    <div>
      <h4 className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold mb-2 px-1 flex items-baseline gap-2">
        <span>{label}</span>
        <span className="text-neutral-400 dark:text-neutral-600 font-normal">
          {clips.length}
        </span>
      </h4>
      {clips.length === 0 ? (
        <p className="text-[11px] text-neutral-500 px-1 leading-snug">{emptyHint}</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
          {clips.map((c) => (
            <BookendTile
              key={c.key}
              clip={c}
              selected={selectedUrl === c.videoUrl}
              onClick={() =>
                onPick(selectedUrl === c.videoUrl ? null : c.videoUrl)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BookendTile({
  clip,
  selected,
  onClick,
}: {
  clip: MergedClip;
  selected: boolean;
  onClick: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  function onEnter() {
    void videoRef.current?.play().catch(() => undefined);
  }
  function onLeave() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  const label = clip.origin.filename ?? "Bookend";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`relative aspect-[9/16] rounded-2xl overflow-hidden border bg-neutral-100 dark:bg-neutral-900 cursor-pointer transition ${
        selected
          ? "border-emerald-500 ring-2 ring-emerald-500/40"
          : "border-neutral-200 dark:border-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-700"
      }`}
    >
      <video
        ref={videoRef}
        src={clip.videoUrl}
        poster={clip.posterUrl}
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
      />
      {selected && (
        <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shadow">
          ✓
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
        <div className="text-[10px] font-medium text-white/95 truncate">{label}</div>
      </div>
    </div>
  );
}

// Group the filtered clips into sections (Category or Language) and render
// each section as a header + sub-grid. Clips that match multiple category
// tags appear under each matching section so the user can find them either
// way; the "Other" bucket catches clips with no matching category.
function GroupedSections({
  groupBy,
  clips,
  renderTile,
  extraTiles,
}: {
  groupBy: "category" | "language";
  clips: MergedClip[];
  renderTile: (clip: MergedClip) => React.ReactNode;
  extraTiles: React.ReactNode;
}) {
  let sections: Array<{ key: string; label: string; clips: MergedClip[] }>;
  if (groupBy === "category") {
    sections = CATEGORY_ORDER.map((cat) => ({
      key: cat.key,
      label: cat.label,
      clips: clips.filter((c) => (c.tags ?? []).includes(cat.tag)),
    }));
    const matchedKeys = new Set(CATEGORY_ORDER.map((c) => c.tag));
    const other = clips.filter((c) => {
      const tags = c.tags ?? [];
      return !tags.some((t) => matchedKeys.has(t));
    });
    if (other.length > 0) sections.push({ key: "other", label: "Other", clips: other });
  } else {
    sections = LANGUAGE_ORDER.map((lang) => ({
      key: lang.key,
      label: lang.label,
      clips: clips.filter((c) => (c.language ?? "multi") === lang.key),
    }));
  }

  const visible = sections.filter((s) => s.clips.length > 0);
  const empty = visible.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Always show the upload + AI tiles in a top row regardless of grouping. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {extraTiles}
      </div>
      {empty ? null : (
        visible.map((s) => (
          <section key={s.key}>
            <h4 className="text-[11px] uppercase tracking-[0.16em] text-neutral-500 font-semibold mb-2 px-1 flex items-baseline gap-2">
              <span>{s.label}</span>
              <span className="text-neutral-400 dark:text-neutral-600 font-normal">
                {s.clips.length}
              </span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {s.clips.map((c) => renderTile(c))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function ClipTile({
  clip,
  selectionNumber,
  dim,
  onClick,
  onDelete,
  onEdit,
  onLanguageChange,
}: {
  clip: MergedClip;
  selectionNumber: number | null;
  dim: boolean;
  onClick: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onLanguageChange?: (lang: ClipLanguage) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  function onEnter() {
    const v = videoRef.current;
    if (!v) return;
    void v.play().catch(() => undefined);
  }

  function onLeave() {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {
      /* ignore */
    }
  }

  const originLabel = (() => {
    if (clip.kind === "saved") {
      return clip.origin.setName ? `From: ${clip.origin.setName}` : "Saved set";
    }
    // Both upload and auto clips: a user-renamed `filename` (stored on the
    // LibraryClip) wins. Auto clips fall back to "Slot N"; uploads to
    // "Uploaded".
    if (clip.origin.filename) return clip.origin.filename;
    if (clip.kind === "upload") return "Uploaded";
    if (typeof clip.origin.promptIndex === "number") {
      return `Slot ${clip.origin.promptIndex + 1}`;
    }
    return "Auto";
  })();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      className={`group relative aspect-[9/16] rounded-2xl overflow-hidden border bg-neutral-100 dark:bg-neutral-900 transition ${
        selectionNumber !== null
          ? "border-emerald-500 ring-2 ring-emerald-500/40"
          : "border-neutral-200 dark:border-neutral-900 hover:border-neutral-400 dark:hover:border-neutral-700"
      } ${dim ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {clip.posterUrl ? (
        <video
          ref={videoRef}
          src={clip.videoUrl}
          poster={clip.posterUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          src={clip.videoUrl}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover bg-neutral-200 dark:bg-neutral-800"
          onLoadedMetadata={onSeekToFirstFrame}
        />
      )}

      {/* Hover actions stack (auto + upload only; saved-set clips are
          managed in the Saved Sets sidebar). Delete sits in the corner; a
          rename pencil appears next to it. */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
          title="Remove from library"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="absolute top-2 left-11 w-7 h-7 rounded-full bg-black/60 hover:bg-neutral-700 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
          title="Edit clip details"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      )}

      {/* Selection badge */}
      <div className="absolute top-2 right-2">
        {selectionNumber !== null ? (
          <div className="w-7 h-7 rounded-full bg-emerald-500 text-white text-[12px] font-bold flex items-center justify-center shadow">
            {selectionNumber}
          </div>
        ) : (
          !dim && (
            <div className="w-7 h-7 rounded-full border-2 border-white/0 group-hover:border-white/80 transition" />
          )
        )}
      </div>

      {/* Language pill (top-right, below the selection badge area). Native
          select for editability — clicking opens a small dropdown. Saved-set
          clips have no editor: just a static pill. */}
      {onLanguageChange ? (
        <label
          className="absolute bottom-2 right-2 z-10"
          onClick={(e) => e.stopPropagation()}
        >
          <select
            value={clip.language ?? "multi"}
            onChange={(e) => onLanguageChange(e.target.value as ClipLanguage)}
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/85 hover:bg-white text-neutral-900 backdrop-blur-sm leading-none tabular-nums tracking-wider cursor-pointer focus:outline-none border-0 appearance-none pr-1.5"
            title="Set clip language"
          >
            {LANGUAGE_ORDER.map((l) => (
              <option key={l.key} value={l.key}>
                {LANGUAGE_SHORT[l.key]}
              </option>
            ))}
          </select>
        </label>
      ) : clip.language ? (
        <span className="absolute bottom-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/70 text-neutral-900 backdrop-blur-sm leading-none tabular-nums tracking-wider">
          {LANGUAGE_SHORT[clip.language]}
        </span>
      ) : null}

      {/* Origin chip + tags */}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent pr-12">
        <div className="text-[10px] font-medium text-white/95 truncate">
          {originLabel}
        </div>
        {clip.tags && clip.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 max-h-8 overflow-hidden">
            {clip.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/20 text-white/95 backdrop-blur-sm leading-none tabular-nums"
              >
                {t.replace(/_/g, " ")}
              </span>
            ))}
            {clip.tags.length > 4 && (
              <span className="text-[8px] text-white/70 leading-none">+{clip.tags.length - 4}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function onSeekToFirstFrame(e: SyntheticEvent<HTMLVideoElement>) {
  const v = e.currentTarget;
  try {
    if (v.duration && v.currentTime === 0) v.currentTime = 0.05;
  } catch {
    /* ignore */
  }
}

function UploadTile({ onUploaded }: { onUploaded?: (libraryClipId: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectClip = useBatchStore((s) => s.selectClip);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { cachedUrl, filename } = await uploadClip(file);
      const clip = addLibraryClip({
        url: cachedUrl,
        kind: "upload",
        filename,
        language: "multi",
      });
      // Auto-select the freshly uploaded clip.
      selectClip(clip.id, cachedUrl);
      // Fire-and-forget tag scan; tags will appear on the tile a few seconds later.
      void tagClip(cachedUrl)
        .then((tags) => updateLibraryClip(clip.id, { tags }))
        .catch(() => undefined);
      // Open the metadata modal so the user can polish name/category/tags
      // while the new clip is fresh in mind.
      onUploaded?.(clip.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => !uploading && inputRef.current?.click()}
      disabled={uploading}
      className="relative aspect-[9/16] rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-800 hover:border-neutral-500 dark:hover:border-neutral-600 bg-neutral-50 dark:bg-neutral-950 transition flex flex-col items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/*"
        onChange={onPick}
        className="hidden"
      />
      {uploading ? (
        <>
          <Spinner />
          <span className="text-[11px] font-medium text-neutral-500">Uploading…</span>
        </>
      ) : (
        <>
          <svg
            className="w-6 h-6 text-neutral-500"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
            Upload clip
          </span>
        </>
      )}
      {error && (
        <span className="absolute inset-x-2 bottom-2 text-[9px] text-red-500 truncate" title={error}>
          {error}
        </span>
      )}
    </button>
  );
}

// Companion tile that opens the manual AI-clip modal (image prompt →
// animation prompt → save to library). Same dashed-tile look as Upload
// so the two creation entry points feel like a pair.
function AiClipTile({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-[9/16] rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-800 hover:border-neutral-500 dark:hover:border-neutral-600 bg-neutral-50 dark:bg-neutral-950 transition flex flex-col items-center justify-center gap-2"
    >
      <svg
        className="w-6 h-6 text-neutral-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 3v4" />
        <path d="M3 5h4" />
        <path d="M19 17v4" />
        <path d="M17 19h4" />
        <path d="M14 4l-2.5 5.5L6 12l5.5 2.5L14 20l2.5-5.5L22 12l-5.5-2.5z" />
      </svg>
      <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 text-center px-2 leading-tight">
        Generate AI clip
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin text-neutral-500" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
