import { TFile, type Plugin } from "obsidian";
import { LearningActivityPresence } from "../../application/LearningActivityPresence";
import type { LearningProgramOrchestrator } from "@nox/core";

/**
 * Host observation only. All durable activity/focus mutations stay in the
 * application orchestrator. Obsidian Plugin owns listener and timer cleanup.
 */
export function bindObsidianLearningLifecycle(
  plugin: Plugin,
  programs: LearningProgramOrchestrator,
): void {
  const activity = new LearningActivityPresence(idle => programs.setIdle(idle));
  const observeInteraction = () => {
    void activity.observeInteraction().catch(error =>
      console.warn("[Nox] Idle resume failed", error));
  };

  plugin.registerDomEvent(document, "keydown", observeInteraction);
  plugin.registerDomEvent(document, "pointerdown", observeInteraction);
  plugin.registerDomEvent(document, "scroll", observeInteraction, true);
  plugin.registerInterval(window.setInterval(() => {
    void activity.checkIdle().catch(error =>
      console.warn("[Nox] Idle checkpoint failed", error));
  }, 30_000));

  plugin.registerEvent(plugin.app.workspace.on("file-open", file => {
    if (file?.extension === "md") void programs.focusMaterial(file.path).catch(() => {});
  }));
  plugin.registerEvent(plugin.app.vault.on("rename", (file, oldPath) => {
    if (file instanceof TFile && file.extension === "md") {
      void programs.renameMaterial(oldPath, file.path).catch(() => {});
    }
  }));
  plugin.registerDomEvent(document, "visibilitychange", () => {
    void programs.setAppInactive(document.hidden).catch(error =>
      console.warn("[Nox] Could not save visibility pause", error));
  });
}
