import { type LearningContext } from "../context/context-types";
import { getPrimaryAction, type ActionMenuEntry } from "./action-menu";
import { createNoxSurface, setNoxIcon } from "./primitives";

export interface EmptyPrimaryPort {
  getPrimaryAction(): Promise<ActionMenuEntry>;
  canStart(): boolean;
  getDraft(): string;
  onBlocked(): void;
  onStart(action: ActionMenuEntry, draft: string): void;
}

/** Stateless empty-slate projections; no vault, settings, or session ownership. */
export function renderEmptyPrimary(slate: HTMLElement, port: EmptyPrimaryPort): void {
    const button = slate.createEl("button", {
      cls: "nox-learning-start",
      attr: { type: "button", "aria-label": "Create a learning plan" },
    });
    const icon = button.createSpan({ cls: "nox-learning-start-icon" });
    const body = button.createDiv({ cls: "nox-learning-start-body" });
    const title = body.createSpan({ cls: "nox-learning-start-title" });
    const description = body.createSpan({ cls: "nox-learning-start-description" });
    const arrow = button.createSpan({ cls: "nox-learning-start-arrow" });
    setNoxIcon(arrow, "arrow-right");

    let action: ActionMenuEntry = getPrimaryAction({
      hasActiveSession: false, savedProgramCount: 0,
      hasPracticeQuestion: false, legacyMode: "free",
    });
    const update = (item: ActionMenuEntry) => {
      action = item;
      setNoxIcon(icon, item.icon);
      title.setText(item.name);
      description.setText(item.description);
      button.setAttribute("aria-label", item.name + ": " + item.description);
    };
    update(action);
    button.addEventListener("click", () => {
      if (!slate.isConnected || !port.canStart()) return;
      const draft = port.getDraft();
      if (draft && (action.command?.trim() !== "/plan" || draft.startsWith("/"))) {
        port.onBlocked();
        return;
      }
      port.onStart(action, draft);
    });
    void port.getPrimaryAction().then(item => {
      if (slate.isConnected && slate.contains(button)) update(item);
    }).catch(() => {
      // Preserve the safe Create plan action when the program index is unavailable.
    });
  }

export function renderEmptyContext(parent: HTMLElement, context: LearningContext | null): void {
    if (!context?.selection && !context?.activeNote) return;

    const wrap = createNoxSurface(parent, "nox-empty-context");
    const left = wrap.createDiv({
      cls: "nox-empty-context-main",
    });
    const icon = left.createSpan({
      cls: "nox-empty-context-icon",
    });
    setNoxIcon(icon, "file-text");

    const copy = left.createDiv({
      cls: "nox-empty-context-copy",
    });
    copy.createSpan({
      cls: "nox-empty-context-label",
      text: "Current context",
    });

    const file =
      context.selection?.file ??
      context.activeNote?.path ??
      "";
    copy.createSpan({
      cls: "nox-empty-context-file",
      text: file.split("/").pop() ?? file,
    });

    if (context.selection) {
      wrap.createSpan({
        cls: "nox-empty-context-meta",
        text: "Selection",
      });
    }
  }


