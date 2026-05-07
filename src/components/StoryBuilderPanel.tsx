"use client";

// Story Builder — top-level panel.
//
// View state machine, top-down:
//   1. project-picker   — Load project / New project (when no active project)
//   2. project-home     — entry to either New shot or Continue, plus Mini Library
//                         and Shot Sequence
//   3. new-shot         — wizard for fresh shots (Upload / Generate / Library →
//                         animation prompt → save)
//   4. continue-shot    — wizard for shots seeded from a prior shot's last frame
//
// The wizards are NOT separate routes — they're transient view states
// that the panel pushes onto/pops off of. Cancel / save returns to
// project-home. This keeps the entire flow on one URL, which the user
// asked for explicitly.

import { useEffect, useState } from "react";
import { useBatchStore } from "@/store/batchStore";
import { ProjectPicker } from "./story/ProjectPicker";
import { ProjectHome } from "./story/ProjectHome";
import { NewShotWizard } from "./story/NewShotWizard";
import { ContinueShotWizard } from "./story/ContinueShotWizard";

type WizardView = "new-shot" | "continue-shot" | null;

export function StoryBuilderPanel() {
  const storyActiveProjectId = useBatchStore((s) => s.storyActiveProjectId);
  const [wizard, setWizard] = useState<WizardView>(null);

  // Reset the wizard when the active project changes (e.g. user
  // switches projects mid-flow). Otherwise a half-finished new-shot
  // dialog from project A would briefly render against project B's
  // library before the user dismisses it.
  useEffect(() => {
    setWizard(null);
  }, [storyActiveProjectId]);

  if (!storyActiveProjectId) {
    return (
      <div className="flex flex-col gap-8 pb-12">
        <ProjectPicker />
      </div>
    );
  }

  if (wizard === "new-shot") {
    return (
      <div className="flex flex-col gap-8 pb-12">
        <NewShotWizard
          projectId={storyActiveProjectId}
          onClose={() => setWizard(null)}
        />
      </div>
    );
  }

  if (wizard === "continue-shot") {
    return (
      <div className="flex flex-col gap-8 pb-12">
        <ContinueShotWizard
          projectId={storyActiveProjectId}
          onClose={() => setWizard(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      <ProjectHome
        projectId={storyActiveProjectId}
        onStartNewShot={() => setWizard("new-shot")}
        onStartContinue={() => setWizard("continue-shot")}
      />
    </div>
  );
}
