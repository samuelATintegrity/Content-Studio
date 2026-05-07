"use client";

// Funny Commercial v2 — main-body panel.
//
// Replaces the v1 fixed 4-scene panel. Top-down sections:
//   1. ActorsSection         — pick / generate actor (face reference)
//   2. ShotsLibrary          — browse all generated shots, drag onto
//                              timeline, animate / re-animate / delete
//   3. ComposeShot           — primary creator: kind toggle, location
//                              ref, prompt, image preview/keep/discard,
//                              animation prompt, animate, keep/discard
//   4. TimelineStrip         — ordered slots, drag-reorder, attach
//                              overlay + narration per slot
//   5. RenderBar             — Render mp4 / Export Premiere zip
//
// Each section is its own React component to keep the file scannable.
// Store coordination is the only piece they all share — actor selection
// drives Compose's reference image, shot library drives both Compose's
// last-frame continuity AND the timeline.

import { ActorsSection } from "./fc/ActorsSection";
import { ShotsLibrary } from "./fc/ShotsLibrary";
import { ComposeShot } from "./fc/ComposeShot";
import { TimelineStrip } from "./fc/TimelineStrip";
import { RenderBar } from "./fc/RenderBar";
import { FcProjectsSection } from "./fc/FcProjectsSection";

export function FunnyCommercialPanel() {
  return (
    <div className="flex flex-col gap-8 pb-12">
      <FcProjectsSection />
      <ActorsSection />
      <ComposeShot />
      <ShotsLibrary />
      <TimelineStrip />
      <RenderBar />
    </div>
  );
}
