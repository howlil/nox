import type { IconName } from "obsidian";
import {
  createNoxChip,
  createNoxIconButton,
  setNoxIcon,
} from "./primitives";
import { createNoxPopover, NoxPopoverState } from "./popover";

export type NoxComposerContext = {
  key: string;
  text: string;
  title?: string;
  icon?: IconName;
};

export type NoxComposerAttachment = {
  key: string;
  text: string;
  title?: string;
  onRemove: () => void;
};

export type NoxComposerOptions = {
  onInput: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onFiles: (files: FileList | null) => void;
  onOpenSourceMenu: () => void;
  onOpenCommandMenu: () => void;
  onToggleModelMenu: () => void;
  onModelKeyDown: (event: KeyboardEvent) => void;
  onCancel: () => void;
  onSend: () => void;
};

/**
 * Shared prompt surface. It owns DOM composition and generic input behavior;
 * feature controllers own context resolution, actions, and request state.
 */
export class NoxComposer {
  private readonly composerBox: HTMLElement;
  private readonly inputLine: HTMLElement;
  private readonly contextRow: HTMLElement;
  readonly promptMenuEl: HTMLElement;
  readonly promptPopover: NoxPopoverState;
  readonly modelMenuEl: HTMLElement;
  readonly modelPopover: NoxPopoverState;
  readonly input: HTMLTextAreaElement;
  readonly sendBtn: HTMLButtonElement;
  readonly cancelBtn: HTMLButtonElement;
  readonly modelTrigger: HTMLButtonElement;
  readonly fileInput: HTMLInputElement;
  readonly promptPlusBtn: HTMLButtonElement;
  readonly actionMenuBtn: HTMLButtonElement;
  private readonly attachmentsEl: HTMLElement;
  private readonly intentEl: HTMLElement;
  readonly anchor: HTMLElement;

  constructor(parent: HTMLElement, options: NoxComposerOptions) {
    this.anchor = parent.createDiv({ cls: "nox-prompt-anchor" });
    this.promptMenuEl = createNoxPopover(this.anchor, {
      cls: "nox-prompt-menu",
      id: "nox-prompt-menu",
      role: "listbox",
      label: "Nox prompt actions",
    });
    this.promptPopover = new NoxPopoverState(this.promptMenuEl);

    this.modelMenuEl = createNoxPopover(this.anchor, {
      cls: "nox-model-menu",
      id: "nox-model-menu",
      role: "listbox",
      label: "Learning models",
    });
    this.modelPopover = new NoxPopoverState(this.modelMenuEl);

    this.composerBox = this.anchor.createDiv({ cls: "nox-composer-box" });
    this.composerBox.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button")) return;
      this.focus();
    });

    const controls = this.composerBox.createDiv({ cls: "nox-composer-controls" });
    this.inputLine = controls.createDiv({ cls: "nox-input-line" });
    this.contextRow = this.inputLine.createDiv({ cls: "nox-context-row nox-hidden" });
    this.contextRow.createDiv({ cls: "nox-chips" });
    this.intentEl = this.inputLine.createDiv({
      cls: "nox-intent-row nox-hidden",
    });
    this.attachmentsEl = this.inputLine.createDiv({
      cls: "nox-attachments nox-hidden",
    });

    this.fileInput = this.inputLine.createEl("input", {
      cls: "nox-file-input",
      attr: {
        type: "file",
        multiple: "",
        accept: ".md,.txt,.csv,.json,.yaml,.yml",
      },
    });
    this.fileInput.addEventListener("change", () => {
      options.onFiles(this.fileInput.files);
    });

    this.input = this.inputLine.createEl("textarea", {
      cls: "nox-input",
      attr: {
        placeholder: "Ask anything about this note...",
        rows: "1",
        "aria-controls": "nox-prompt-menu",
      },
    });
    this.input.addEventListener("input", () => {
      this.syncInputLayout();
      options.onInput();
    });
    this.input.addEventListener("keydown", options.onKeyDown);

    const footer = controls.createDiv({ cls: "nox-composer-footer" });
    this.promptPlusBtn = createNoxIconButton(footer, {
      cls: "nox-prompt-plus",
      icon: "plus",
      label: "Add context or file",
      title: "Add context or file",
    });
    this.promptPlusBtn.setAttribute("aria-controls", "nox-prompt-menu");
    this.promptPlusBtn.setAttribute("aria-expanded", "false");
    this.promptPlusBtn.addEventListener("click", options.onOpenSourceMenu);

    const tools = footer.createDiv({ cls: "nox-composer-tools" });
    this.actionMenuBtn = tools.createEl("button", {
      cls: "nox-action-menu-btn",
      attr: {
        type: "button",
        "aria-label": "Show Nox actions",
        "aria-controls": "nox-prompt-menu",
        "aria-expanded": "false",
      },
    });
    this.actionMenuBtn.createSpan({
      cls: "nox-action-menu-key",
      text: "/",
    });
    this.actionMenuBtn.createSpan({ text: "Actions" });
    this.actionMenuBtn.addEventListener("click", options.onOpenCommandMenu);

    this.modelTrigger = tools.createEl("button", {
      cls: "nox-model-trigger",
      attr: {
        type: "button",
        "aria-controls": "nox-model-menu",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
      },
    });
    this.modelTrigger.title = "Choose learning model";
    this.modelTrigger.addEventListener("click", options.onToggleModelMenu);
    this.modelTrigger.addEventListener("keydown", options.onModelKeyDown);

    const btnGroup = footer.createDiv({ cls: "nox-btn-group" });
    this.cancelBtn = createNoxIconButton(btnGroup, {
      cls: "nox-cancel-btn nox-hidden",
      icon: "x",
      label: "Stop generating",
      title: "Stop",
    });
    this.cancelBtn.addEventListener("click", options.onCancel);

    this.sendBtn = createNoxIconButton(btnGroup, {
      cls: "nox-send-btn",
      icon: "arrow-up",
      label: "Send message",
      title: "Send message",
    });
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", options.onSend);

    this.syncInputLayout();
  }

  focus(): void {
    this.input.focus();
  }

  setContexts(contexts: NoxComposerContext[]): void {
    const chips = this.contextRow.querySelector<HTMLElement>(".nox-chips");
    if (!chips) return;

    chips.empty();
    for (const context of contexts) {
      const chip = createNoxChip(chips, {
        cls: "nox-context-chip",
        text: context.text,
        icon: context.icon,
      });
      chip.dataset.contextKey = context.key;
      if (context.title) chip.title = context.title;
    }
    this.contextRow.toggleClass("nox-hidden", contexts.length === 0);
    this.syncInputLayout();
  }

  setAttachments(attachments: NoxComposerAttachment[]): void {
    this.attachmentsEl.empty();
    this.attachmentsEl.toggleClass("nox-hidden", attachments.length === 0);

    for (const attachment of attachments) {
      const chip = createNoxChip(this.attachmentsEl, {
        cls: "nox-attachment-chip",
        variant: "attachment",
        icon: "file-text",
        iconClass: "nox-attachment-icon",
        labelClass: "nox-attachment-name",
        text: attachment.text,
        removeClass: "nox-attachment-remove",
        removeLabel: `Remove ${attachment.text}`,
        onRemove: attachment.onRemove,
      });
      chip.dataset.attachmentKey = attachment.key;
      if (attachment.title) chip.title = attachment.title;
    }
    this.syncInputLayout();
  }

  setIntent(
    label: string | null,
    className: string,
    onRemove: () => void,
  ): HTMLElement | null {
    this.intentEl.empty();
    const visible = Boolean(label);
    this.intentEl.toggleClass("nox-hidden", !visible);
    if (!label) {
      this.syncInputLayout();
      return null;
    }

    const chip = createNoxChip(this.intentEl, {
      cls: `nox-intent-chip ${className}`,
      variant: "intent",
      text: label,
      labelClass: "nox-intent-label",
      removeClass: "nox-intent-remove",
      removeLabel: `Exit ${label} mode`,
      onRemove,
    });
    this.syncInputLayout();
    return chip;
  }

  setModelLabel(label: string): void {
    this.modelTrigger.empty();
    this.modelTrigger.createSpan({
      cls: "nox-model-trigger-label",
      text: label,
    });
    const chevron = this.modelTrigger.createSpan({
      cls: "nox-model-trigger-chevron",
    });
    setNoxIcon(chevron, "chevron-down");
    this.modelTrigger.setAttribute("aria-label", `Learning model: ${label}`);
  }

  setPlaceholder(placeholder: string): void {
    this.input.placeholder = placeholder;
  }

  syncInputLayout(): void {
    const lineHeight = Number.parseFloat(getComputedStyle(this.input).lineHeight) || 18;
    const maxHeight = 80;

    this.input.style.height = "auto";
    const expanded = this.input.value.includes("\n") || this.input.scrollHeight > lineHeight + 2;
    const wasExpanded = this.composerBox.hasClass("is-expanded");
    this.composerBox.toggleClass("is-expanded", expanded);

    this.input.style.height = "auto";
    const contentHeight = Math.min(this.input.scrollHeight, maxHeight);
    this.input.style.height = `${Math.max(lineHeight, contentHeight)}px`;
    this.input.style.overflowY = this.input.scrollHeight > maxHeight ? "auto" : "hidden";

    if (expanded !== wasExpanded) {
      this.input.style.height = "auto";
      const relaidOutHeight = Math.min(this.input.scrollHeight, maxHeight);
      this.input.style.height = `${Math.max(lineHeight, relaidOutHeight)}px`;
    }
  }

  setState({ busy, disabled, canSend }: {
    busy: boolean;
    disabled: boolean;
    canSend: boolean;
  }): void {
    this.cancelBtn.disabled = !busy;
    this.cancelBtn.toggleClass("nox-hidden", !busy);
    this.input.disabled = busy || disabled;
    this.sendBtn.disabled = busy || disabled || !canSend;
  }

  setSendEnabled(enabled: boolean): void {
    this.sendBtn.disabled = !enabled;
  }
}
