import { TFile, type Plugin } from "obsidian";
import { LearningActivityPresence } from "../../application/LearningActivityPresence";
import type { LearningProgramOrchestrator } from "@nox/core";
import { BackgroundWriteFeedback } from "./background-write-feedback";

/**
 * Host observation only. All durable activity/focus mutations stay in the
 * application orchestrator. Obsidian Plugin owns listener and timer cleanup.
 * Rename retries are memory-only and use the existing 30-second idle timer.
 */
export function bindObsidianLearningLifecycle(
  plugin: Plugin,
  programs: LearningProgramOrchestrator,
  feedback: BackgroundWriteFeedback = new BackgroundWriteFeedback(() => {}),
): void {
  const activity = new LearningActivityPresence(idle => programs.setIdle(idle));
  const pendingRenames: Array<{ from: string; to: string }> = [];
  let draining: Promise<void> | null = null;

  // Serial retries maintain rename order: A→B must be saved before B→C.
  const flushRenames = (): void => {
    if (draining || pendingRenames.length === 0) return;
    const operation = (async () => {
      while (pendingRenames.length > 0) {
        const { from, to } = pendingRenames[0];
        try {
          await programs.renameMaterial(from, to);
          pendingRenames.shift();
          feedback.success("rename");
        } catch (error) {
          feedback.failure("rename", error);
          return; // Retry on the next existing 30-second observer tick.
        }
      }
    })();
    draining = operation;
    void operation.finally(() => { if (draining === operation) draining = null; });
  };

  const observeInteraction = () => {
    void feedback.observe("idle", () => activity.observeInteraction());
  };

  plugin.registerDomEvent(document, "keydown", observeInteraction);
  plugin.registerDomEvent(document, "pointerdown", observeInteraction);
  plugin.registerDomEvent(document, "scroll", observeInteraction, true);
  plugin.registerInterval(window.setInterval(() => {
    void feedback.observe("idle", () => activity.checkIdle());
    flushRenames();
  }, 30_000));

  plugin.registerEvent(plugin.app.workspace.on("file-open", file => {
    if (file?.extension === "md") {
      void feedback.observe("focus", () => programs.focusMaterial(file.path));
    }
  }));
  plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => {
    if (file instanceof TFile && file.extension === "md") {
      pendingRenames.push({ from: oldPath, to: file.path });
      flushRenames();
    }
  }));
  plugin.registerDomEvent(document, "visibilitychange", () => {
    void feedback.observe("visibility", () => programs.setAppInactive(document.hidden));
  });
}
