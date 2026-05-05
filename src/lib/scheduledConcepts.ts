// Scheduled-concepts cooldown tracker.
//
// User flow: each AI-poster card carries a conceptKey (a snake_case
// label for its visual metaphor — e.g. "apex_predator" for tigers,
// "matchstick_in_stadium" for the lit match). When the user
// successfully schedules a card via Buffer, we record its
// conceptKey here. The next AI-poster batch reads the recent list
// and tells Claude to avoid those conceptKeys + visually similar
// metaphors for a 14-day cooldown window.
//
// Storage: a single JSON manifest on R2 at the path below. Append-
// only with periodic prune (entries older than 60 days are dropped
// on write). One file = no S3 list-and-collate dance, and the
// document is small enough that read/modify/write is fine for the
// solo-user volume the app sees.

import { getObjectBytes, putBytes } from "./r2Server";

const MANIFEST_KEY = "library/scheduled-concepts.json";
const PRUNE_OLDER_THAN_DAYS = 60;
const DEFAULT_RECENT_DAYS = 14;

export interface ScheduledConceptEntry {
  conceptKey: string;
  scheduledAt: string; // ISO 8601
}

interface Manifest {
  entries: ScheduledConceptEntry[];
}

async function readManifest(): Promise<Manifest> {
  try {
    const bytes = await getObjectBytes(MANIFEST_KEY);
    if (!bytes) return { entries: [] };
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Manifest>;
    if (!parsed.entries || !Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries };
  } catch (e) {
    console.warn(
      "[scheduledConcepts] readManifest failed, treating as empty:",
      e instanceof Error ? e.message : String(e),
    );
    return { entries: [] };
  }
}

async function writeManifest(m: Manifest): Promise<void> {
  const body = new TextEncoder().encode(JSON.stringify(m, null, 2));
  await putBytes({ key: MANIFEST_KEY, body, contentType: "application/json" });
}

// Append a conceptKey to the cooldown list. Idempotent on the
// (conceptKey, ISO-day) pair — if the user reschedules the same
// concept the same day we don't bloat the file with duplicates.
// Entries older than PRUNE_OLDER_THAN_DAYS are dropped on each
// write so the manifest stays small.
export async function recordScheduledConcept(conceptKey: string): Promise<void> {
  const trimmed = conceptKey?.trim();
  if (!trimmed) return;
  try {
    const m = await readManifest();
    const today = new Date().toISOString().slice(0, 10);
    const alreadyToday = m.entries.some(
      (e) => e.conceptKey === trimmed && e.scheduledAt.slice(0, 10) === today,
    );
    if (!alreadyToday) {
      m.entries.push({ conceptKey: trimmed, scheduledAt: new Date().toISOString() });
    }
    const cutoff = Date.now() - PRUNE_OLDER_THAN_DAYS * 86_400_000;
    m.entries = m.entries.filter((e) => {
      const t = Date.parse(e.scheduledAt);
      return Number.isFinite(t) && t >= cutoff;
    });
    await writeManifest(m);
    console.log(
      `[scheduledConcepts] recorded "${trimmed}" (${m.entries.length} entries in cooldown)`,
    );
  } catch (e) {
    // Don't fail the surrounding flow (a Buffer schedule, etc.) just
    // because we couldn't write the cooldown record. Worst case the
    // user might see the concept once more in the next batch.
    console.warn(
      "[scheduledConcepts] recordScheduledConcept failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

// Get distinct conceptKeys scheduled in the last N days. Used by
// generateAiPosterBatch to ask Claude to skip those + similar
// metaphors.
export async function getRecentScheduledConcepts(days = DEFAULT_RECENT_DAYS): Promise<string[]> {
  try {
    const m = await readManifest();
    const cutoff = Date.now() - days * 86_400_000;
    const recent = m.entries
      .filter((e) => {
        const t = Date.parse(e.scheduledAt);
        return Number.isFinite(t) && t >= cutoff;
      })
      .map((e) => e.conceptKey);
    return Array.from(new Set(recent));
  } catch (e) {
    console.warn(
      "[scheduledConcepts] getRecentScheduledConcepts failed; returning empty list:",
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}
