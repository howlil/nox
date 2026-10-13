import type { IconName } from "obsidian";
import { createNoxButton, createNoxIconButton, setNoxIcon } from "./primitives";

export type NoxSelection = {
  file: string;
  content: string;
};

export type NoxSelectionAction = {
  id: string;
  label: string;
  icon: IconName;
  learningAction: "explain" | "edit";
  prompt: string;
};

export type NoxSelectionActionSet = {
  primary: NoxSelectionAction[];
  more: NoxSelectionAction[];
};

export const DEFAULT_NOX_SELECTION_ACTIONS: NoxSelectionActionSet = {
  primary: [
    {
      id: "explain",
      label: "Explain",
      icon: "circle-help",
      learningAction: "explain",
      prompt: "Explain this selection.",
    },
    {
      id: "improve",
      label: "Improve",
      icon: "sparkles",
      learningAction: "edit",
      prompt: "Improve this selection while preserving its meaning.",
    },
  ],
  more: [
    {
      id: "shorten",
      label: "Shorten",
      icon: "scissors",
      learningAction: "edit",
      prompt: "Shorten this selection while preserving its meaning.",
    },
    {
      id: "tone",
      label: "Tone",
      icon: "smile",
      learningAction: "edit",
      prompt: "Change the tone of this selection while preserving its meaning.",
    },
    {
      id: "grammar",
      label: "Grammar",
      icon: "text",
      learningAction: "edit",
      prompt: "Fix the grammar in this selection without changing its meaning.",
    },
  ],
};

export type NoxSelectionActionsOptions = {
  actions?: NoxSelectionActionSet;
  onAction: (action: NoxSelectionAction) => void;
};

/**
 * Reusable selection affordance. It owns only local disclosure and disabled
 * state; the host owns context resolution, request execution, and results.
 */
export class NoxSelectionActions {
  readonly root: HTMLElement;

  private readonly selectionLabel: HTMLElement;
  private readonly selectionMeta: HTMLElement;
  private readonly primaryEl: HTMLElement;
  private readonly moreEl: HTMLElement;
  private readonly moreToggle: HTMLButtonElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly actions: NoxSelectionActionSet;
  private expanded = false;
  private busy = false;
  private hasSelection = false;

  constructor(parent: HTMLElement, options: NoxSelectionActionsOptions) {
    this.actions = options.actions ?? DEFAULT_NOX_SELECTION_ACTIONS;
    this.root = parent.createDiv({
      cls: "nox-selection-actions nox-hidden",
      attr: {
        "aria-label": "Selection actions",
        "aria-hidden": "true",
      },
    });

    const header = this.root.createDiv({ cls: "nox-selection-actions-header" });
    const context = header.createDiv({ cls: "nox-selection-actions-context" });
    const icon = context.createSpan({ cls: "nox-selection-actions-icon" });
    setNoxIcon(icon, "text-select");
    context.createSpan({
      cls: "nox-selection-actions-tag",
      text: "@selection",
    });
    this.selectionLabel = context.createSpan({
      cls: "nox-selection-actions-file",
    });
    this.selectionMeta = header.createSpan({
      cls: "nox-selection-actions-meta",
    });

    const body = this.root.createDiv({ cls: "nox-selection-actions-body" });
    this.primaryEl = body.createDiv({ cls: "nox-selection-actions-primary" });
    this.moreEl = body.createDiv({
      cls: "nox-selection-actions-more nox-hidden",
    });

    for (const action of this.actions.primary) {
      this.addActionButton(this.primaryEl, action, options.onAction);
    }

    for (const action of this.actions.more) {
      this.addActionButton(this.moreEl, action, options.onAction);
    }

    this.moreToggle = createNoxIconButton(body, {
      cls: "nox-selection-actions-more-toggle",
      icon: "chevron-down",
      label: "Show more selection actions",
      title: "More selection actions",
    });
    this.moreToggle.setAttribute("aria-expanded", "false");
    this.moreToggle.addEventListener("click", () => this.toggleMore());
  }

  setSelection(selection: NoxSelection | null): void {
    const visible = Boolean(selection?.content.trim());
    this.hasSelection = visible;
    this.syncDisabledState();
    this.root.toggleClass("nox-hidden", !visible);
    this.root.setAttribute("aria-hidden", String(!visible));

    if (!visible || !selection) {
      this.root.removeClass("is-visible");
      this.selectionLabel.textContent = "";
      this.selectionMeta.textContent = "";
      this.setExpanded(false);
      return;
    }

    const file = selection.file.split("/").pop() ?? selection.file;
    const words = selection.content.trim().split(/\s+/).filter(Boolean).length;
    this.selectionLabel.textContent = file;
    this.selectionMeta.textContent = `${words} ${words === 1 ? "word" : "words"}`;

    if (!this.root.hasClass("is-visible")) {
      this.root.addClass("is-visible");
    }
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.root.toggleClass("is-busy", busy);
    this.syncDisabledState();
  }

  private addActionButton(
    parent: HTMLElement,
    action: NoxSelectionAction,
    onAction: (action: NoxSelectionAction) => void,
  ): void {
    const button = createNoxButton(parent, {
      cls: "nox-selection-action",
      text: action.label,
      icon: action.icon,
      variant: "quiet",
    });
    button.addEventListener("click", () => {
      if (this.busy || !this.hasSelection) return;
      onAction(action);
    });
    this.buttons.push(button);
  }

  private toggleMore(): void {
    this.setExpanded(!this.expanded);
  }

  private syncDisabledState(): void {
    for (const button of this.buttons) {
      button.disabled = this.busy || !this.hasSelection;
    }
    this.moreToggle.disabled = this.busy || !this.hasSelection;
  }

  private setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.moreEl.toggleClass("nox-hidden", !expanded);
    this.moreToggle.setAttribute("aria-expanded", String(expanded));
    this.moreToggle.setAttribute(
      "aria-label",
      expanded ? "Show fewer selection actions" : "Show more selection actions",
    );
    setNoxIcon(this.moreToggle, expanded ? "chevron-up" : "chevron-down");
  }
}
