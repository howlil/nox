import {
  ItemView,
  MarkdownRenderer,
  WorkspaceLeaf,
  type IconName,
} from "obsidian";
import { LearningController } from "../learning/LearningController";
import {
  LearningActionKind,
  LearningEvent,
  LearningRequest,
} from "../learning/learning-types";
import {
  ExplicitContextRef,
  LearningContext,
} from "../context/context-types";
import {
  PracticeEvaluation,
  PracticeQuestion,
} from "../learning/practice-types";
import { ReviewFinding } from "../learning/review-types";
import { ChatMessage, EditProposal, type AgentModel, type ChatSession } from "../types";
import { ProposedEdit } from "../learning/learning-types";
import {
  parsePromptToken,
  PromptMenuKind,
  stripPromptToken,
} from "./prompt-token";
import { NOX_CAPABILITIES } from "./capabilities";
import { animateNoxEnter, animateNoxPopover } from "./motion";
import { resolveNoxMarkdownLink } from "./markdown-links";
import {
  shouldResetAction,
  TerminalOutcome,
} from "./chat-state";
import {
  createNoxButton,
  createNoxIconButton,
  createNoxMessageMeta,
  createNoxMenuRow,
  createNoxSurface,
  createNoxStatus,
  setNoxIcon,
} from "../ui/primitives";
import { NoxMenuState } from "../ui/menu";
import { createNoxPopover, NoxPopoverState } from "../ui/popover";
import { NoxComposer, type NoxComposerContext } from "../ui/composer";
import {
  NoxSelectionActions,
  type NoxSelectionAction,
} from "../ui/selection-actions";

export const NOX_VIEW_TYPE = "nox-sidebar";

type UIState =
  | "EMPTY"
  | "RUNNING"
  | "ANSWER"
  | "PROPOSAL"
  | "APPLIED"
  | "ERROR";

const ACTIONS: Array<{
  kind: LearningActionKind;
  label: string;
}> = [
  { kind: "ask", label: "Ask" },
  ...NOX_CAPABILITIES.map((capability) => ({
    kind: capability.action,
    label: capability.title,
  })),
];

const PROMPT_COMMANDS = NOX_CAPABILITIES;

type PromptMenuAction =
  | { type: "attach" }
  | { type: "info" }
  | { type: "vault-note"; path: string }
  | { type: "learning"; kind: Exclude<LearningActionKind, "ask"> };

interface PromptMenuItem {
  key: string;
  name: string;
  description: string;
  icon: IconName;
  command?: string;
  disabled?: boolean;
  action: PromptMenuAction;
}

export class ChatView extends ItemView {
  private thread!: HTMLElement;
  private composer!: HTMLElement;
  private composerUi!: NoxComposer;
  private selectionActions!: NoxSelectionActions;
  private headerEl!: HTMLElement;
  private historyBtn!: HTMLButtonElement;
  private historyMenuEl!: HTMLElement;
  private historyPopover!: NoxPopoverState;
  private readonly historyMenuState = new NoxMenuState();

  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private modelTrigger!: HTMLButtonElement;
  private modelMenuEl: HTMLElement | null = null;
  private modelPopover!: NoxPopoverState;
  private readonly modelMenuState = new NoxMenuState();
  private models: AgentModel[] = [];
  private fileInput!: HTMLInputElement;
  private promptPlusBtn!: HTMLButtonElement;
  private actionMenuBtn!: HTMLButtonElement;
  private commandHintBtn: HTMLButtonElement | null = null;
  private promptMenuEl: HTMLElement | null = null;
  private promptPopover!: NoxPopoverState;
  private promptMenu: PromptMenuKind | null = null;
  private readonly promptMenuState = new NoxMenuState();
  private promptMenuRequest = 0;
  private attachments: Array<{
    name: string;
    ref: ExplicitContextRef;
  }> = [];

  private agentCursorEl: HTMLElement | null = null;
  private agentContentEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private loadingElapsedEl: HTMLElement | null = null;
  private loadingStartedAt = 0;
  private loadingTimer: number | null = null;
  private thinkingToggleEl: HTMLButtonElement | null = null;
  private thinkingLabelEl: HTMLElement | null = null;
  private thinkingChevronEl: HTMLElement | null = null;
  private thinkingPanelEl: HTMLElement | null = null;
  private thinkingRows: HTMLElement[] = [];
  private thinkingManualExpanded: boolean | null = null;
  private streamedResponseText = "";
  private streamingPendingText = "";

  private uiState: UIState = "EMPTY";
  private selectedAction: LearningActionKind = "ask";
  private runningAction: LearningActionKind | null = null;
  private capabilityCards = new Map<LearningActionKind, HTMLButtonElement>();
  private systemContextFiles: string[] = [];
  private lastTurnRequest: LearningRequest | null = null;
  private turnTerminal = false;
  private workspaceEventsRegistered = false;
  private runtimeReady = false;
  private runtimeFailureMessage: string | null = null;
  private contextSyncRequest = 0;
  private turnContextSource: string | null = null;
  private pendingFindingSource: string | null = null;

  private extraCtx: ExplicitContextRef[] = [];
  private currentContext: LearningContext | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly learning: LearningController,
    private readonly openSettings: () => void,
    private readonly getLogoUrl: () => string,
  ) {
    super(leaf);
  }

  getViewType() {
    return NOX_VIEW_TYPE;
  }

  getDisplayText() {
    return "Nox";
  }

  getIcon() {
    return "nox-logo";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("nox-root");

    this.buildHeader(root);
    this.thread = root.createDiv({ cls: "nox-thread" });
    this.composer = root.createDiv({ cls: "nox-composer" });
    this.selectionActions = new NoxSelectionActions(this.composer, {
      onAction: (action) => this.runSelectionAction(action),
    });
    this.buildComposer(this.composer);

    // Local transcripts remain available even if AGY is offline.
    await this.restoreRuntimeState();
    await this.ensureRuntimeReady();
  }

  async onClose(): Promise<void> {
    this.learning.cancel();
    this.stopLoadingTimer();
  }

  private async ensureRuntimeReady(): Promise<boolean> {
    try {
      const health = await this.learning.checkRuntime();
      if (health.status === "ready") {
        this.runtimeReady = true;
        this.runtimeFailureMessage = null;
        this.thread.querySelector(".nox-runtime-error")?.remove();
        this.setUIState(this.learning.getSession().messages.length ? "ANSWER" : "EMPTY");
        return true;
      }
      this.showRuntimeError(health.failure.message);
    } catch {
      this.showRuntimeError("Agent runtime is unavailable. Check Nox runtime settings.");
    }
    return false;
  }

  private showRuntimeError(message: string): void {
    this.runtimeReady = false;
    this.runtimeFailureMessage = message;
    this.thread.querySelector(".nox-runtime-error")?.remove();
    const row = this.thread.createDiv({ cls: "nox-runtime-error" });
    this.appendInlineStatus(row, "failed", message, () => void this.retryRuntime());
    this.setUIState("ERROR");
  }

  private async restoreRuntimeState(): Promise<void> {
    await this.syncChips();
    await this.restoreSession();

    if (!this.workspaceEventsRegistered) {
      this.workspaceEventsRegistered = true;
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          void this.syncChips();
        }),
      );
      this.registerEvent(
        this.app.workspace.on("editor-selection-change" as any, () => {
          void this.syncChips();
        }),
      );
    }

    void this.refreshModelList();
  }

  private async retryRuntime(): Promise<void> {
    if (this.uiState === "RUNNING") return;

    if (!(await this.ensureRuntimeReady())) return;
    await this.restoreRuntimeState();
    this.focusComposer();
  }

  focusComposer(): void {
    this.input?.focus();
  }

  private buildHeader(root: HTMLElement): void {
    this.headerEl = root.createDiv({ cls: "nox-header" });
    const top = this.headerEl.createDiv({ cls: "nox-header-top" });
    const brand = top.createDiv({ cls: "nox-header-brand" });
    brand.createEl("img", {
      cls: "nox-header-logo",
      attr: {
        src: this.getLogoUrl(),
        alt: "Nox",
      },
    });

    const copy = brand.createDiv({ cls: "nox-header-copy" });
    copy.createSpan({ cls: "nox-header-title", text: "Nox" });

    const right = top.createDiv({ cls: "nox-header-right" });

    this.historyBtn = createNoxIconButton(right, {
      cls: "nox-history-btn",
      icon: "history",
      label: "Open chat history",
      title: "Chat history",
    });
    this.historyBtn.setAttribute("aria-controls", "nox-history-menu");
    this.historyBtn.setAttribute("aria-expanded", "false");
    this.historyBtn.addEventListener("click", () => this.toggleHistoryMenu());
    this.historyBtn.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.historyMenuState.isOpen) {
        event.preventDefault();
        this.closeHistoryMenu();
      }
    });

    const newBtn = createNoxIconButton(right, {
      cls: "nox-new-btn",
      icon: "plus",
      label: "New learning session",
      title: "New learning session",
    });
    newBtn.addEventListener("click", async () => {
      if (this.uiState === "RUNNING") return;
      try {
        await this.learning.newSession();
        this.lastTurnRequest = null;
        this.pendingFindingSource = null;
        this.systemContextFiles = [];
        this.extraCtx = [];
        this.attachments = [];
        this.renderAttachments();
        this.closePromptMenu();
        this.closeModelMenu();
        this.setAction("ask");
        await this.syncChips();
        this.showEmpty();
        this.renderHistoryMenu();
        this.focusComposer();
      } catch (error) {
        console.warn(
          "[Nox] Could not start a new session",
          error instanceof Error ? error.message : String(error),
        );
        this.appendInlineStatus(
          this.thread,
          "failed",
          "Could not start a new session.",
        );
      }
    });

    const moreBtn = createNoxIconButton(right, {
      cls: "nox-more-btn",
      icon: "more-horizontal",
      label: "Open Nox settings",
      title: "Nox settings",
    });
    moreBtn.addEventListener("click", () => this.openSettings());

    this.historyMenuEl = createNoxPopover(this.headerEl, {
      cls: "nox-history-menu",
      id: "nox-history-menu",
      role: "menu",
      label: "Chat history",
    });
    this.historyPopover = new NoxPopoverState(this.historyMenuEl);
    this.syncHistoryTrigger();
  }

  private toggleHistoryMenu(): void {
    if (this.historyMenuState.isOpen) {
      this.closeHistoryMenu();
      return;
    }

    this.closePromptMenu();
    this.closeModelMenu();
    this.historyMenuState.openAt(0);
    this.renderHistoryMenu();
  }

  private closeHistoryMenu(): void {
    this.historyMenuState.close();
    this.historyPopover?.close();
    this.syncHistoryTrigger();
  }

  private syncHistoryTrigger(): void {
    if (!this.historyBtn) return;
    this.historyMenuState.syncTrigger(this.historyBtn, "nox-history-menu");
  }

  private renderHistoryMenu(): void {
    if (!this.historyMenuEl) return;

    this.historyMenuEl.empty();
    this.historyPopover.setOpen(this.historyMenuState.isOpen);
    this.syncHistoryTrigger();
    if (!this.historyMenuState.isOpen) return;

    const header = this.historyMenuEl.createDiv({ cls: "nox-history-header" });
    header.createSpan({ cls: "nox-history-title", text: "Chat history" });
    header.createSpan({
      cls: "nox-history-hint",
      text: "Stored in this vault",
    });

    const sessions = this.learning.listSessions();
    if (sessions.length === 0) {
      this.historyMenuEl.createDiv({
        cls: "nox-history-empty",
        text: "No conversations yet.",
      });
      this.historyMenuState.setRows([]);
      return;
    }

    const rows: HTMLButtonElement[] = [];
    const currentId = this.learning.getSession().id;
    for (const session of sessions) {
      const row = createNoxMenuRow(this.historyMenuEl, {
        cls: "nox-history-row",
        id: `nox-history-option-${session.id}`,
        icon: "message-circle",
        name: this.getHistoryTitle(session),
        nameClass: "nox-history-row-name",
        description: this.getHistoryPreview(session),
        descriptionClass: "nox-history-row-preview",
        command: this.formatHistoryTime(session.updatedAt),
        commandClass: "nox-history-row-time",
        selected: session.id === currentId,
        trailingClass: "nox-history-row-check",
        trailingIcon: session.id === currentId ? "check" : undefined,
      });
      row.addEventListener("click", () => {
        void this.selectHistorySession(session.id);
      });
      rows.push(row);
    }

    this.historyMenuState.setRows(rows);
    this.historyMenuState.syncRows();
    animateNoxPopover(this.historyMenuEl);
  }

  private getHistoryTitle(session: ChatSession): string {
    const firstPrompt = session.messages.find(
      (message) => message.role === "user" && message.content.trim(),
    )?.content.trim();
    return firstPrompt ? this.truncateHistoryText(firstPrompt, 48) : "New session";
  }

  private getHistoryPreview(session: ChatSession): string {
    const lastMessage = [...session.messages]
      .reverse()
      .find((message) => message.content.trim());
    if (!lastMessage) return "No messages yet";

    const count = session.messages.length;
    return `${count} ${count === 1 ? "message" : "messages"} · ${this.truncateHistoryText(lastMessage.content, 52)}`;
  }

  private truncateHistoryText(text: string, maxLength: number): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized.length > maxLength
      ? `${normalized.slice(0, maxLength - 1)}…`
      : normalized;
  }

  private formatHistoryTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  private async selectHistorySession(id: string): Promise<void> {
    if (this.uiState === "RUNNING") return;

    const session = await this.learning.selectSession(id);
    if (!session) return;

    this.closeHistoryMenu();
    this.lastTurnRequest = null;
    this.pendingFindingSource = null;
    this.systemContextFiles = [];
    this.extraCtx = [];
    this.attachments = [];
    this.renderAttachments();
    this.closePromptMenu();
    this.closeModelMenu();
    this.setAction(this.learning.hasActivePracticeQuestion() ? "practice" : "ask");
    await this.syncChips();
    await this.restoreSession();
    if (!this.runtimeReady && this.runtimeFailureMessage) {
      this.showRuntimeError(this.runtimeFailureMessage);
    }
    this.focusComposer();
  }

  private async refreshModelList(): Promise<void> {
    this.models = this.learning.getModels();
    if (this.modelMenuState.isOpen) {
      this.modelMenuState.setActive(this.getSelectedModelIndex());
    }
    this.syncModelTrigger();
    this.renderModelMenu();
  }

  private getModelMenuItems(): AgentModel[] {
    return [
      { id: "", name: "Runtime default" },
      ...this.models,
    ];
  }

  private getSelectedModelIndex(): number {
    const selected = this.learning.getSession().model ?? "";
    const index = this.getModelMenuItems().findIndex(
      (model) => model.id === selected,
    );
    return index >= 0 ? index : 0;
  }

  private syncModelTrigger(): void {
    if (!this.modelTrigger) return;

    const selected = this.learning.getSession().model ?? "";
    const model = this.getModelMenuItems().find((item) => item.id === selected);
    const label = model?.name ?? "Runtime default";

    this.composerUi?.setModelLabel(label);
    this.modelMenuState.syncTrigger(this.modelTrigger, "nox-model-menu");
    this.modelTrigger.setAttribute("aria-label", `Learning model: ${label}`);
  }

  private openModelMenu(): void {
    this.closePromptMenu();
    this.modelMenuState.openAt(this.getSelectedModelIndex());
    this.syncModelTrigger();
    this.renderModelMenu();
  }

  private closeModelMenu(): void {
    if (!this.modelMenuState.isOpen && !this.modelMenuEl?.hasChildNodes()) return;

    this.modelMenuState.close();
    this.syncModelTrigger();
    this.renderModelMenu();
  }

  private toggleModelMenu(): void {
    if (this.modelMenuState.isOpen) {
      this.closeModelMenu();
    } else {
      this.openModelMenu();
    }
  }

  private renderModelMenu(): void {
    if (!this.modelMenuEl) return;

    this.modelMenuEl.empty();
    this.modelPopover.setOpen(this.modelMenuState.isOpen);
    this.syncModelTrigger();

    if (!this.modelMenuState.isOpen) return;

    const selected = this.learning.getSession().model ?? "";
    const rows: HTMLButtonElement[] = [];
    for (const [index, model] of this.getModelMenuItems().entries()) {
      const row = createNoxMenuRow(this.modelMenuEl, {
        cls: "nox-model-menu-row",
        id: `nox-model-menu-option-${index}`,
        name: model.name,
        nameClass: "nox-model-menu-name",
        selected: model.id === selected,
        trailingClass: "nox-model-menu-check",
        trailingIcon: model.id === selected ? "check" : undefined,
      });

      row.addEventListener("mouseenter", () => {
        this.modelMenuState.setActive(index);
        this.syncModelMenuRows();
      });
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => {
        void this.selectModel(model.id);
      });
      rows.push(row);
    }

    this.modelMenuState.setRows(rows);
    this.syncModelMenuRows();
    animateNoxPopover(this.modelMenuEl);
  }

  private syncModelMenuRows(): void {
    const selected = this.learning.getSession().model ?? "";
    const rows = this.modelMenuEl?.querySelectorAll<HTMLButtonElement>(
      ".nox-model-menu-row",
    ) ?? [];
    rows.forEach((row, index) => {
      row.setAttribute(
        "aria-selected",
        String(this.getModelMenuItems()[index]?.id === selected),
      );
    });
    this.modelMenuState.syncTrigger(this.modelTrigger, "nox-model-menu");
  }

  private async selectModel(modelId: string): Promise<void> {
    await this.learning.setModel(modelId || undefined);
    this.closeModelMenu();
    this.modelTrigger.focus();
  }

  private onModelTriggerKey(event: KeyboardEvent): void {
    const items = this.getModelMenuItems();

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!this.modelMenuState.isOpen) {
        this.openModelMenu();
        return;
      }

      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.modelMenuState.move(direction);
      this.syncModelMenuRows();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && this.modelMenuState.isOpen) {
      event.preventDefault();
      const model = items[this.modelMenuState.activeIndex];
      if (model) this.selectModel(model.id);
      return;
    }

    if (event.key === "Escape" && this.modelMenuState.isOpen) {
      event.preventDefault();
      this.closeModelMenu();
      return;
    }

    if (event.key === "Tab" && this.modelMenuState.isOpen) {
      this.closeModelMenu();
    }
  }

  private buildComposer(parent: HTMLElement): void {
    this.composerUi = new NoxComposer(parent, {
      onInput: () => this.onInput(),
      onKeyDown: (event) => this.onKey(event),
      onFiles: (files) => void this.handleFiles(files),
      onOpenSourceMenu: () => {
        this.closeModelMenu();
        if (this.promptMenu === "source") {
          this.closePromptMenu();
        } else {
          this.promptMenu = "source";
          this.promptMenuState.openAt(this.getPromptMenuStartIndex("source"));
          void this.renderPromptMenu();
        }
        this.composerUi.focus();
      },
      onOpenCommandMenu: () => {
        this.closeModelMenu();
        if (this.promptMenu === "command") {
          this.closePromptMenu();
        } else {
          this.promptMenu = "command";
          this.promptMenuState.openAt(this.getPromptMenuStartIndex("command"));
          void this.renderPromptMenu();
        }
        this.composerUi.focus();
      },
      onToggleModelMenu: () => this.toggleModelMenu(),
      onModelKeyDown: (event) => this.onModelTriggerKey(event),
      onCancel: () => {
        this.learning.cancel();
        this.composerUi.cancelBtn.disabled = true;
      },
      onSend: () => void this.doSend(),
    });

    this.promptMenuEl = this.composerUi.promptMenuEl;
    this.promptPopover = this.composerUi.promptPopover;
    this.modelMenuEl = this.composerUi.modelMenuEl;
    this.modelPopover = this.composerUi.modelPopover;
    this.input = this.composerUi.input;
    this.fileInput = this.composerUi.fileInput;
    this.promptPlusBtn = this.composerUi.promptPlusBtn;
    this.actionMenuBtn = this.composerUi.actionMenuBtn;
    this.modelTrigger = this.composerUi.modelTrigger;
    this.cancelBtn = this.composerUi.cancelBtn;
    this.sendBtn = this.composerUi.sendBtn;
    this.syncModelTrigger();
    this.registerDomEvent(document, "pointerdown", (event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (this.composerUi.anchor.contains(target) || this.headerEl.contains(target))
      ) {
        return;
      }
      this.closePromptMenu();
      this.closeModelMenu();
      this.closeHistoryMenu();
    });
  }

  private renderAttachments(): void {
    this.composerUi.setAttachments(
      this.attachments.map((attachment) => ({
        key: attachment.name,
        text: attachment.name,
        onRemove: () => {
          const index = this.attachments.indexOf(attachment);
          if (index < 0) return;
          this.attachments.splice(index, 1);
          this.extraCtx = this.attachments.map((item) => item.ref);
          this.renderAttachments();
          void this.syncChips();
        },
      })),
    );
  }

  private async handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    this.closePromptMenu();

    for (const file of Array.from(files)) {
      const content = await file.text();
      this.attachments.push({
        name: file.name,
        ref: {
          kind: "attachment",
          name: file.name,
          content,
        },
      });
    }

    this.extraCtx = this.attachments.map((item) => item.ref);
    this.renderAttachments();
    this.fileInput.value = "";
    await this.syncChips();
    this.composerUi.focus();
  }

  private async getPromptMenuItems(): Promise<PromptMenuItem[]> {
    if (this.promptMenu === "command") {
      return PROMPT_COMMANDS.map((command) => ({
        key: command.action,
        name: command.title,
        description: command.description,
        icon: command.icon,
        command: command.command,
        action: { type: "learning" as const, kind: command.action },
      }));
    }

    const items: PromptMenuItem[] = [];
    const token = parsePromptToken(this.input.value);
    const query = token?.kind === "source" ? token.query : "";

    if (this.currentContext?.selection) {
      items.push({
        key: "current-selection",
        name: "Current selection",
        description: this.currentContext.selection.file,
        icon: "check",
        disabled: true,
        action: { type: "info" },
      });
    } else if (this.currentContext?.activeNote) {
      items.push({
        key: "current-note",
        name: this.currentContext.activeNote.path.split("/").pop() ??
          this.currentContext.activeNote.path,
        description: "Current note · automatic context",
        icon: "file-text",
        disabled: true,
        action: { type: "info" },
      });
    }

    if (query) {
      const excluded = new Set([
        this.currentContext?.activeNote?.path,
        this.currentContext?.selection?.file,
        ...this.extraCtx
          .filter(
            (item): item is Extract<
              ExplicitContextRef,
              { kind: "vault-note" }
            > => item.kind === "vault-note",
          )
          .map((item) => item.path),
      ].filter((value): value is string => Boolean(value)));

      for (const note of this.learning.searchNotes(query, 6)) {
        if (excluded.has(note.path)) continue;
        items.push({
          key: `note:${note.path}`,
          name: note.name,
          description: note.path,
          icon: "file-text",
          action: { type: "vault-note", path: note.path },
        });
      }
    }

    items.push({
      key: "attach",
      name: "Attach text file",
      description: "Markdown, text, CSV, JSON, or YAML",
      icon: "paperclip",
      action: { type: "attach" },
    });

    return items;
  }

  private async renderPromptMenu(): Promise<void> {
    if (!this.promptMenuEl) return;

    const requestId = ++this.promptMenuRequest;
    this.promptMenuEl.empty();
    this.promptPopover.setOpen(this.promptMenuState.isOpen);
    this.syncPromptMenuControls();
    if (!this.promptMenu) {
      this.promptMenuState.close();
      this.promptPopover.close();
      this.input.removeAttribute("aria-expanded");
      this.input.removeAttribute("aria-activedescendant");
      return;
    }

    this.input.setAttribute("aria-expanded", "true");

    const token = parsePromptToken(this.input.value);
    const query = token?.kind === this.promptMenu ? token.query : "";
    const rows = await this.getPromptMenuItems();
    if (requestId !== this.promptMenuRequest || !this.promptMenu) return;

    let interactiveIndex = 0;
    const rowsForState: HTMLButtonElement[] = [];
    for (const item of rows) {
      const menuIndex = item.disabled ? -1 : interactiveIndex++;
      const button = createNoxMenuRow(this.promptMenuEl, {
        cls: "nox-prompt-menu-row",
        id: `nox-prompt-menu-option-${menuIndex}`,
        icon: item.icon,
        iconClass: "nox-prompt-menu-icon",
        name: item.name,
        nameClass: "nox-prompt-menu-name",
        description: item.description,
        descriptionClass: "nox-prompt-menu-description",
        command: item.command,
        commandClass: "nox-prompt-menu-command",
        disabled: item.disabled,
      });

      if (!item.disabled) {
        button.addEventListener("mouseenter", () => {
          this.promptMenuState.setActive(menuIndex);
          this.syncPromptMenuRows();
        });
        button.addEventListener("click", () => void this.pickPromptMenuItem(item));
        rowsForState.push(button);
      }
    }

    this.promptMenuEl.createDiv({
      cls: "nox-prompt-menu-hint",
      text: this.promptMenu === "source"
        ? query ? "Select a note or attach a text file" : "Type @name to search vault notes"
        : "Choose a learning action",
    });
    this.promptMenuState.setRows(rowsForState);
    this.syncPromptMenuRows();
    animateNoxPopover(this.promptMenuEl);
  }

  private syncPromptMenuControls(): void {
    const sourceOpen = this.promptMenu === "source";
    const commandOpen = this.promptMenu === "command";

    this.promptPlusBtn?.setAttribute("aria-expanded", String(sourceOpen));
    this.actionMenuBtn?.setAttribute("aria-expanded", String(commandOpen));
    this.commandHintBtn?.setAttribute("aria-expanded", String(commandOpen));
    this.commandHintBtn?.setAttribute("aria-controls", "nox-prompt-menu");
  }

  private syncPromptMenuRows(): void {
    this.promptMenuState.syncRows();
    const rows = this.promptMenuEl?.querySelectorAll<HTMLButtonElement>(
      ".nox-prompt-menu-row:not(:disabled)",
    ) ?? [];
    rows.forEach((row, index) => {
      const active = index === this.promptMenuState.activeIndex;
      row.setAttribute("aria-selected", String(active));
    });

    const activeRow = rows[this.promptMenuState.activeIndex];
    if (activeRow) {
      this.input.setAttribute("aria-activedescendant", activeRow.id);
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  private async pickPromptMenuItem(item: PromptMenuItem): Promise<void> {
    const action = item.action;
    if (action.type === "attach") {
      this.input.value = stripPromptToken(this.input.value);
      this.onInput();
      this.closePromptMenu();
      this.fileInput.click();
      return;
    }
    if (action.type === "info") return;

    const token = parsePromptToken(this.input.value);
    const prefix = token ? this.input.value.slice(0, token.start) : this.input.value;

    if (action.type === "vault-note") {
      const exists = this.extraCtx.some(
        (item) =>
          item.kind === "vault-note" &&
          item.path === action.path,
      );

      if (!exists) {
        const ref: ExplicitContextRef = {
          kind: "vault-note",
          path: action.path,
        };

        this.attachments.push({
          name: action.path.split("/").pop() ?? action.path,
          ref,
        });
        this.extraCtx = this.attachments.map((item) => item.ref);
        this.renderAttachments();
        await this.syncChips();
      }

      this.input.value = prefix;
      this.closePromptMenu();
      this.onInput();
      this.input.focus();
      return;
    }

    this.setAction(action.kind);
    this.input.value = prefix;
    this.closePromptMenu();
    this.onInput();
    this.input.focus();
  }

  private closePromptMenu(): void {
    this.promptMenuRequest += 1;
    this.promptMenu = null;
    this.promptMenuState.close();
    this.promptPopover.close();
    this.syncPromptMenuControls();
    void this.renderPromptMenu();
  }

  private getPromptMenuStartIndex(menu: PromptMenuKind): number {
    if (menu !== "command") return 0;

    const selected = PROMPT_COMMANDS.findIndex(
      (command) => command.action === this.selectedAction,
    );
    return selected >= 0 ? selected : 0;
  }

  private setAction(action: LearningActionKind): void {
    this.selectedAction = action;
    if (this.promptMenu === "command") {
      this.promptMenuState.setActive(this.getPromptMenuStartIndex("command"));
    }
    this.updatePlaceholder();
    this.renderIntent();
    this.syncCapabilityCards();
    this.syncPromptMenuRows();
  }

  private runSelectionAction(action: NoxSelectionAction): void {
    if (this.uiState === "RUNNING" || !this.runtimeReady || !this.currentContext?.selection) return;

    this.pendingFindingSource = null;
    this.setAction(action.learningAction);
    this.input.value = action.prompt;
    this.onInput();
    this.composerUi.focus();
    void this.doSend();
  }

  private syncCapabilityCards(): void {
    for (const [kind, card] of this.capabilityCards) {
      const selected = kind === this.selectedAction;
      card.toggleClass("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
  }

  private renderIntent(): void {
    const label = this.selectedAction === "ask"
      ? null
      : ACTIONS.find((item) => item.kind === this.selectedAction)?.label ?? this.selectedAction;
    const chip = this.composerUi.setIntent(
      label,
      `nox-intent-chip--${this.selectedAction}`,
      () => {
        this.setAction("ask");
        this.composerUi.focus();
      },
    );
    if (chip) animateNoxEnter(chip, 3);
  }

  private updatePlaceholder(): void {
    const hasSelection = Boolean(this.currentContext?.selection);
    const hasNote = Boolean(this.currentContext?.activeNote);

    const askPlaceholder = hasSelection
      ? "Ask about this selection..."
      : hasNote
        ? "Ask about this note..."
        : "Ask Nox...";

    const placeholders: Record<LearningActionKind, string> = {
      ask: askPlaceholder,
      explain: hasSelection
        ? "What should I explain about this selection?"
        : "What should I explain?",
      practice: hasSelection
        ? "Practice this selection..."
        : "What should we practice?",
      review: hasNote
        ? "What should I review in this note?"
        : "What should I review?",
      edit: hasNote
        ? "How should I improve this note?"
        : "What should I improve?",
    };

    if (this.input) {
      this.input.placeholder = placeholders[this.selectedAction];
    }
  }

  private async syncChips(): Promise<void> {
    const requestId = ++this.contextSyncRequest;
    let context: LearningContext;
    try {
      context = await this.learning.resolveContext(this.extraCtx);
    } catch {
      // Deleted supporting notes receive an actionable error at turn start.
      return;
    }
    if (requestId !== this.contextSyncRequest) return;
    this.currentContext = context;
    this.syncContextChips();
    this.selectionActions?.setSelection(
      context.selection
        ? {
            file: context.selection.file,
            content: context.selection.content,
          }
        : null,
    );

    this.updatePlaceholder();

    if (
      this.uiState === "EMPTY" &&
      this.thread.querySelector(".nox-empty-slate")
    ) {
      this.showEmpty();
    }
  }

  private syncContextChips(): void {
    const contexts: NoxComposerContext[] = [];
    const selection = this.currentContext?.selection;
    if (selection) {
      contexts.push({
        key: "selection",
        text: "@selection",
        title: selection.file,
        icon: "file-text",
      });
    }

    const activeNote = this.currentContext?.activeNote;
    if (!selection && activeNote) {
      contexts.push({
        key: "note",
        text: `@${activeNote.path.split("/").pop() ?? activeNote.path}`,
        title: activeNote.path,
        icon: "file-text",
      });
    }

    if (this.systemContextFiles.length > 0) {
      contexts.push({
        key: "system",
        text: "@nox-system",
        title: this.systemContextFiles.join("\n"),
        icon: "file-text",
      });
    }

    this.composerUi.setContexts(contexts);
  }

  private onInput(): void {
    this.closeModelMenu();
    this.composerUi.syncInputLayout();
    this.composerUi.setSendEnabled(
      this.canSend() && this.uiState !== "RUNNING" && this.uiState !== "ERROR",
    );

    const token = parsePromptToken(this.input.value);
    if (token && this.promptMenu !== token.kind) {
      this.promptMenu = token.kind;
      this.promptMenuState.openAt(this.getPromptMenuStartIndex(token.kind));
    } else if (!token) {
      this.closePromptMenu();
    }

    this.renderPromptMenu();

  }

  private onKey(event: KeyboardEvent): void {
    if (this.promptMenu && this.promptMenuState.rowCount > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        this.promptMenuState.move(direction);
        this.syncPromptMenuRows();
        return;
      }

      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const rows = this.promptMenuEl?.querySelectorAll<HTMLButtonElement>(
          ".nox-prompt-menu-row:not(:disabled)",
        ) ?? [];
        const row = rows[this.promptMenuState.activeIndex];
        if (row) row.click();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!this.sendBtn.disabled) void this.doSend();
    }

    if (event.key === "Escape") {
      if (this.promptMenu) {
        this.closePromptMenu();
      } else if (this.modelMenuState.isOpen) {
        this.closeModelMenu();
      } else if (this.historyMenuState.isOpen) {
        this.closeHistoryMenu();
      } else if (this.uiState === "RUNNING") {
        this.cancelBtn.click();
      }
    }
  }

  private async doSend(): Promise<void> {
    const prompt = this.input.value.trim() || "Review the attached context.";
    if (!this.canSend() || this.uiState === "RUNNING") return;

    this.closeModelMenu();
    const request: LearningRequest = {
      prompt,
      action: this.selectedAction,
      explicitContext: [...this.extraCtx],
      sourcePath: (this.selectedAction === "edit" || this.selectedAction === "practice")
        ? this.pendingFindingSource ?? undefined
        : undefined,
    };

    this.lastTurnRequest = request;
    await this.runTurn(request, true);
  }

  private async retryLastTurn(): Promise<void> {
    if (!this.lastTurnRequest || this.uiState === "RUNNING") return;

    this.thread
      .querySelectorAll(".nox-inline-status--failed")
      .forEach((status) => status.remove());

    await this.runTurn(this.lastTurnRequest, false);
  }

  private async runTurn(
    request: LearningRequest,
    appendUserMessage: boolean,
  ): Promise<void> {
    this.closePromptMenu();

    this.input.value = "";
    this.composerUi.syncInputLayout();
    this.attachments = [];
    this.extraCtx = [];
    this.renderAttachments();
    this.sendBtn.disabled = true;

    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.statusEl = null;
    this.streamedResponseText = "";
    this.streamingPendingText = "";
    this.stopLoadingTimer();
    this.turnTerminal = false;

    this.runningAction = request.action;
    this.turnContextSource = null;
    if (appendUserMessage) this.appendUserBubble(request.prompt);
    this.setUIState("RUNNING");
    this.ensureThinkingTrace();

    try {
      for await (const event of this.learning.run({
        ...request,
        retry: !appendUserMessage,
      })) {
        this.handleLearningEvent(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[Nox] Unexpected turn failure", message);
      this.terminateTurn(
        "failed",
        "Nox hit an unexpected error. Try again.",
      );
    }
  }

  private handleLearningEvent(event: LearningEvent): void {
    if (event.type === "context-ready") {
      this.currentContext = event.context.resolved;
      this.turnContextSource =
        event.context.resolved.selection?.file ??
        event.context.resolved.activeNote?.path ?? null;
      this.systemContextFiles = event.context.system.map((item) => item.file);
      this.syncContextChips();
      this.setThinkingStage(1);
      return;
    }

    if (event.type === "response-delta") {
      const shouldFollow = this.isNearThreadBottom();
      this.setThinkingStage(2);
      this.appendToAgentBubble(event.text);
      if (shouldFollow) this.scrollThread("auto");
      return;
    }

    if (event.type === "practice-question") {
      this.setThinkingStage(2);
      this.ensureAgentBubble();
      this.appendPracticeQuestion(event.question);
      return;
    }

    if (event.type === "practice-evaluation") {
      this.setThinkingStage(2);
      this.ensureAgentBubble();
      this.appendPracticeEvaluation(event.evaluation);
      return;
    }

    if (event.type === "review-findings") {
      this.setThinkingStage(2);
      this.ensureAgentBubble();
      this.appendReviewFindings(event.findings, this.turnContextSource);
      return;
    }

    if (event.type === "learning-state-updated") {
      this.appendProgressUpdate(event.state.currentTopic, event.state.gaps);
      return;
    }

    if (event.type === "mutation-proposed") {
      // The request remains running even after a proposal is streamed.
      this.appendProposalBubble(event.edit);
      return;
    }

    if (event.type === "completed") {
      this.terminateTurn("completed");
      return;
    }

    if (event.type === "cancelled") {
      this.terminateTurn("stopped", "Stopped.");
      return;
    }

    if (event.type === "failed") {
      this.terminateTurn("failed", event.failure.message);
    }
  }

  private terminateTurn(
    outcome: TerminalOutcome,
    message?: string,
  ): void {
    if (this.turnTerminal) return;
    this.turnTerminal = true;

    const action = this.runningAction;
    if (this.uiState === "RUNNING") this.setUIState("ANSWER");

    if (outcome === "completed") {
      this.finishStreamingBubble();
    } else {
      this.finishStreamingBubble(
        outcome === "stopped" ? "Stopped" : "Unable to finish",
      );
      this.appendInlineStatus(
        this.thread,
        outcome,
        message ?? (outcome === "stopped" ? "Stopped." : "Unable to finish."),
        outcome === "failed" ? () => void this.retryLastTurn() : undefined,
      );
      this.setUIState("ANSWER");
    }

    if (action && shouldResetAction(
      action,
      outcome,
      this.learning.hasActivePracticeQuestion(),
    )) {
      this.setAction("ask");
    }
    this.runningAction = null;
  }

  private finishStreamingBubble(doneLabel?: string): void {
    const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
    this.flushStreamingText();
    this.renderMarkdownResponse();
    if (doneLabel === undefined) this.appendStreamActions();
    this.settleThinking(doneLabel ?? `Completed in ${elapsed}`);
    this.stopLoadingTimer();
    this.agentCursorEl?.removeClass("nox-bubble--streaming");
    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.statusEl = null;
    this.thinkingToggleEl = null;
    this.thinkingLabelEl = null;
    this.thinkingChevronEl = null;
    this.thinkingPanelEl = null;
    this.thinkingRows = [];
    this.thinkingManualExpanded = null;
  }

  private settleThinking(doneLabel: string): void {
    if (!this.thinkingLabelEl) return;

    this.thinkingLabelEl.textContent = doneLabel;
    this.thinkingLabelEl.removeClass("nox-thinking-label--active");
    this.thinkingLabelEl.addClass("nox-thinking-label--done");

    for (const row of this.thinkingRows) {
      row.removeClass("nox-hidden");
      row.removeClass("is-active");
      row.addClass("is-done");

      const marker = row.firstElementChild as HTMLElement | null;
      if (marker) {
        marker.textContent = "✓";
        marker.removeClass("nox-thinking-marker--spinner");
      }
    }

    const expanded = this.thinkingManualExpanded ?? false;
    this.thinkingPanelEl?.toggleClass("is-expanded", expanded);
    this.thinkingToggleEl?.setAttribute("aria-expanded", String(expanded));
    this.thinkingChevronEl?.toggleClass("is-expanded", expanded);
  }

  private setThinkingStage(activeIndex: number): void {
    if (!this.thinkingRows.length) return;

    for (const [index, row] of this.thinkingRows.entries()) {
      const marker = row.firstElementChild as HTMLElement | null;
      const isDone = index < activeIndex;
      const isActive = index === activeIndex;

      row.toggleClass("nox-hidden", index > activeIndex);
      row.toggleClass("is-active", isActive);
      row.toggleClass("is-done", isDone);

      if (!marker) continue;
      marker.toggleClass("nox-thinking-marker--spinner", isActive);
      marker.textContent = isDone ? "✓" : "";
    }

    if (activeIndex > 0 && this.thinkingManualExpanded === null) {
      this.thinkingPanelEl?.addClass("is-expanded");
      this.thinkingToggleEl?.setAttribute("aria-expanded", "true");
      this.thinkingChevronEl?.addClass("is-expanded");
    }
  }

  private startLoadingTimer(): void {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }

    const update = () => {
      const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
      if (this.loadingElapsedEl) this.loadingElapsedEl.textContent = elapsed;
    };

    this.loadingStartedAt = Date.now();
    update();
    this.loadingTimer = window.setInterval(update, 100);
  }

  private stopLoadingTimer(): void {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }

    this.loadingElapsedEl = null;
  }

  private formatElapsed(milliseconds: number): string {
    const seconds = milliseconds / 1000;

    if (seconds < 60) return `${seconds.toFixed(1)}s`;

    return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
  }

  private setUIState(state: UIState): void {
    this.uiState = state;

    const busy = state === "RUNNING";
    this.selectionActions?.setBusy(busy);
    this.composerUi.setState({
      busy,
      disabled: state === "ERROR",
      canSend: this.canSend(),
    });
  }

  private canSend(): boolean {
    return this.input.value.trim().length > 0 || this.attachments.length > 0;
  }

  private showEmpty(): void {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
    this.statusEl = null;
    this.capabilityCards.clear();

    const slate = this.thread.createDiv({
      cls: "nox-empty-slate",
    });

    this.renderEmptyContext(slate);

    const intro = slate.createDiv({
      cls: "nox-empty-intro",
    });
    intro.createDiv({
      cls: "nox-empty-title",
      text: "What do you want to work on?",
    });
    intro.createDiv({
      cls: "nox-empty-description",
      text:
        "Choose a focused action for the current note, or ask Nox directly.",
    });

    const section = slate.createDiv({
      cls: "nox-capability-section",
    });
    const sectionHead = section.createDiv({
      cls: "nox-capability-header",
    });
    sectionHead.createSpan({
      cls: "nox-capability-label",
      text: "Focused actions",
    });

    const commandHint = sectionHead.createEl("button", {
      cls: "nox-capability-command-hint",
      text: "Type / to see all actions",
      attr: {
        type: "button",
        "aria-label": "Show all Nox actions",
        "aria-controls": "nox-prompt-menu",
        "aria-expanded": "false",
      },
    });
    this.commandHintBtn = commandHint;
    commandHint.addEventListener("click", () => {
      this.promptMenu = "command";
      this.promptMenuState.openAt(this.getPromptMenuStartIndex("command"));
      void this.renderPromptMenu();
      this.focusComposer();
    });

    const grid = section.createDiv({
      cls: "nox-capability-grid",
    });

    for (const capability of NOX_CAPABILITIES) {
      const card = grid.createEl("button", {
        cls:
          `nox-capability-card ` +
          `nox-capability-card--${capability.tone}`,
        attr: {
          type: "button",
          "aria-label": capability.title,
          "aria-pressed": String(this.selectedAction === capability.action),
        },
      });

      const top = card.createDiv({
        cls: "nox-capability-card-top",
      });
      const name = top.createDiv({
        cls: "nox-capability-name",
      });
      const icon = name.createSpan({
        cls: "nox-capability-icon",
      });
      setNoxIcon(icon, capability.icon as IconName);
      name.createSpan({
        cls: "nox-capability-title",
        text: capability.title,
      });
      top.createSpan({
        cls: "nox-capability-command",
        text: capability.command,
      });

      card.createDiv({
        cls: "nox-capability-description",
        text: capability.description,
      });
      card.createSpan({
        cls: "nox-capability-meta",
        text: capability.meta,
      });

      card.addEventListener("click", () => {
        this.setAction(capability.action);
        this.focusComposer();
      });
      this.capabilityCards.set(capability.action, card);
    }

    this.syncCapabilityCards();

    this.setUIState(this.runtimeReady ? "EMPTY" : "ERROR");
    animateNoxEnter(slate, 5);
  }

  private renderEmptyContext(parent: HTMLElement): void {
    const context = this.currentContext;
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

  private async restoreSession(): Promise<void> {
    const messages = this.learning.getSession().messages;
    if (messages.length === 0) {
      this.showEmpty();
      return;
    }

    this.thread.empty();
    for (const message of messages) {
      if (message.role === "user") {
        this.appendUserBubble(message.content);
        continue;
      }
      if (message.content.trim()) {
        await this.appendRestoredAssistant(message.content, message.sourcePath);
      }
      if (message.proposal) {
        this.appendRestoredProposal(message);
      }
    }
    this.setUIState(this.runtimeReady ? "ANSWER" : "ERROR");
    this.scrollThread();
  }

  private async appendRestoredAssistant(
    markdown: string,
    messageSourcePath?: string,
  ): Promise<void> {
    const bubble = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--agent",
    });
    createNoxMessageMeta(bubble, {
      label: "Nox",
      sub: "Restored",
    });
    const content = bubble.createDiv({
      cls: "nox-bubble-content nox-markdown",
    });
    const sourcePath = messageSourcePath ??
      this.currentContext?.selection?.file ??
      this.currentContext?.activeNote?.path ??
      "Nox.md";
    await MarkdownRenderer.render(
      this.app,
      markdown,
      content,
      sourcePath,
      this,
    );
    this.wireMarkdownLinks(content, sourcePath);
  }

  private appendRestoredProposal(message: ChatMessage): void {
    const proposal = message.proposal;
    if (!proposal) return;
    const wrap = this.renderProposal(proposal);
    const state = message.proposalState ?? "stale";

    if (state === "pending" && message.proposalId) {
      this.appendProposalActions(wrap, {
        id: message.proposalId,
        proposal,
      });
      return;
    }

    const labels: Record<"applied" | "rejected" | "stale", string> = {
      applied: `✓ Applied to ${proposal.file}`,
      rejected: "✕ Rejected",
      stale: "⚠ Expired after restart",
    };
    const settledState = state === "applied" || state === "rejected"
      ? state
      : "stale";
    const resultKind = settledState === "applied"
      ? "success"
      : settledState === "rejected"
        ? "neutral"
        : "warning";
    createNoxStatus(wrap, {
      cls: `nox-result-badge nox-badge--${settledState}`,
      kind: resultKind,
      text: labels[settledState],
    });
  }

  private showError(message: string): void {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
    this.statusEl = null;

    const slate = this.thread.createDiv({
      cls: "nox-error-slate",
    });
    slate.createDiv({
      cls: "nox-error-icon",
      text: "⚠",
    });
    slate.createDiv({
      cls: "nox-error-title",
      text: "Nox unavailable",
    });
    slate.createDiv({
      cls: "nox-error-body",
      text: message,
    });

    const actions = slate.createDiv({ cls: "nox-error-actions" });
    const retry = createNoxButton(actions, {
      cls: "nox-retry-btn",
      variant: "accent",
      text: "Retry",
    });
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Checking…";
      void this.retryRuntime();
    });

    const configure = createNoxButton(actions, {
      cls: "nox-configure-btn",
      variant: "secondary",
      text: "Configure Nox",
    });
    configure.addEventListener("click", () => {
      this.openSettings();
    });

    this.setUIState("ERROR");
  }

  private appendUserBubble(text: string): void {
    this.thread.querySelector(".nox-empty-slate")?.remove();
    const bubble = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--user",
    });
    bubble.setText(text);
    animateNoxEnter(bubble, 4);
  }

  private ensureThinkingTrace(): void {
    if (this.statusEl) return;
    this.statusEl = this.buildThinkingTrace();
  }

  private ensureAgentBubble(streaming = false): void {
    this.ensureThinkingTrace();
    if (this.agentCursorEl) {
      this.agentCursorEl.toggleClass("nox-bubble--streaming", streaming);
      return;
    }

    this.agentCursorEl = this.thread.createDiv({
      cls: `nox-bubble nox-bubble--agent${streaming ? " nox-bubble--streaming" : ""}`,
    });
    createNoxMessageMeta(this.agentCursorEl, {
      label: "Nox",
      sub:
        ACTIONS.find(
          (action) => action.kind === (this.runningAction ?? this.selectedAction),
        )?.label ?? "Response",
    });
    this.agentContentEl = this.agentCursorEl.createDiv({
      cls: "nox-bubble-content",
    });
    animateNoxEnter(this.agentCursorEl, 4);
  }

  private buildThinkingTrace(): HTMLElement {
    const trace = this.thread.createDiv({ cls: "nox-thinking" });
    trace.setAttribute("role", "status");
    trace.setAttribute("aria-live", "polite");

    const toggle = trace.createEl("button", {
      cls: "nox-thinking-toggle",
      attr: { type: "button", "aria-expanded": "false" },
    });
    this.thinkingToggleEl = toggle;

    toggle.createEl("img", {
      cls: "nox-thinking-logo",
      attr: { src: this.getLogoUrl(), alt: "" },
    });

    this.thinkingLabelEl = toggle.createSpan({
      cls: "nox-thinking-label nox-thinking-label--active",
      text: "Thinking",
    });
    this.loadingElapsedEl = toggle.createSpan({ cls: "nox-thinking-elapsed" });
    this.loadingElapsedEl.setAttribute("aria-hidden", "true");

    const chevron = toggle.createSpan({ cls: "nox-thinking-chevron", text: "⌄" });
    this.thinkingChevronEl = chevron;

    const panel = trace.createDiv({ cls: "nox-thinking-panel" });
    this.thinkingPanelEl = panel;
    const list = panel.createDiv({ cls: "nox-thinking-trace nox-thinking-trace--facts" });

    const source = this.currentContext?.selection?.file ?? this.currentContext?.activeNote?.path;
    const facts: Array<{ primary: string; secondary?: string }> = [
      {
        primary: "Resolving context",
        secondary: source?.split("/").pop(),
      },
      {
        primary: `Running ${ACTIONS.find((action) => action.kind === this.runningAction)?.label ?? "Ask"}`,
      },
      { primary: "Generating response" },
    ];

    this.thinkingRows = facts.map((fact) => {
      const row = list.createDiv({ cls: "nox-thinking-row nox-hidden" });
      row.createSpan({ cls: "nox-thinking-marker" });
      row.createSpan({ cls: "nox-thinking-primary", text: fact.primary });
      if (fact.secondary) row.createSpan({ cls: "nox-thinking-secondary", text: fact.secondary });
      return row;
    });

    this.setThinkingStage(0);

    toggle.addEventListener("click", () => {
      const expanded = !panel.hasClass("is-expanded");
      panel.toggleClass("is-expanded", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      chevron.toggleClass("is-expanded", expanded);
      this.thinkingManualExpanded = expanded;
    });

    this.startLoadingTimer();
    animateNoxEnter(trace, 4);
    return trace;
  }

  private appendToAgentBubble(text: string): void {
    this.ensureAgentBubble(true);
    if (!this.agentContentEl) return;

    this.streamedResponseText += text;
    this.streamingPendingText += text;

    const parts = this.streamingPendingText.split(/(\s+)/);
    const lastPart = parts[parts.length - 1] ?? "";
    const hasTrailingWhitespace = /\s$/.test(this.streamingPendingText);

    if (!hasTrailingWhitespace) {
      this.streamingPendingText = parts.pop() ?? lastPart;
    } else {
      this.streamingPendingText = "";
    }

    for (const part of parts) {
      if (!part) continue;

      if (/\s+/.test(part)) {
        this.agentContentEl.appendText(part);
        continue;
      }

      this.agentContentEl.createSpan({
        cls: "nox-stream-word",
        text: part,
      });
    }

    this.scrollThread();
  }

  private flushStreamingText(): void {
    if (!this.agentContentEl || !this.streamingPendingText) return;

    this.agentContentEl.createSpan({
      cls: "nox-stream-word",
      text: this.streamingPendingText,
    });
    this.streamingPendingText = "";
  }

  private renderMarkdownResponse(): void {
    if (!this.agentContentEl || !this.streamedResponseText.trim()) return;

    const content = this.agentContentEl;
    const markdown = this.streamedResponseText;
    const sourcePath =
      this.currentContext?.selection?.file ??
      this.currentContext?.activeNote?.path ??
      "Nox.md";

    content.empty();
    content.addClass("nox-markdown");

    void MarkdownRenderer.render(this.app, markdown, content, sourcePath, this)
      .then(() => this.wireMarkdownLinks(content, sourcePath))
      .catch(() => {
        content.empty();
        content.removeClass("nox-markdown");
        content.addClass("nox-markdown-error");
        content.setText("Markdown response could not be rendered.");
      });
  }

  private wireMarkdownLinks(content: HTMLElement, sourcePath: string): void {
    this.registerDomEvent(content, "click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement) || !content.contains(anchor)) {
        return;
      }

      const linkText = resolveNoxMarkdownLink(
        anchor.dataset.href ?? anchor.getAttribute("href"),
        anchor.classList.contains("internal-link"),
      );
      if (!linkText) return;

      event.preventDefault();
      event.stopPropagation();

      const newLeaf = event.ctrlKey || event.metaKey || event.button === 1;
      void this.app.workspace.openLinkText(linkText, sourcePath, newLeaf);
    });
  }

  private appendStreamActions(): void {
    if (!this.agentCursorEl || !this.streamedResponseText.trim()) return;

    const responseText = this.streamedResponseText.trim();
    const actions = this.agentCursorEl.createDiv({
      cls: "nox-stream-actions",
    });
    const copyButton = createNoxButton(actions, {
      cls: "nox-stream-action",
      variant: "quiet",
      label: "Copy response",
      text: "Copy",
    });

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(responseText);
        copyButton.textContent = "Copied";
      } catch {
        copyButton.textContent = "Copy failed";
      }

      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    });
  }

  private appendPracticeQuestion(
    question: PracticeQuestion,
  ): void {
    if (!this.agentCursorEl) return;

    const card = createNoxSurface(this.agentCursorEl, "nox-practice-card");
    card.createDiv({
      cls: "nox-practice-label",
      text: `Practice · ${question.concept}`,
    });
    card.createDiv({
      cls: "nox-practice-question",
      text: question.question,
    });

    if (question.hint) {
      card.createDiv({
        cls: "nox-practice-hint",
        text: `Hint: ${question.hint}`,
      });
    }

    this.scrollThread();
  }

  private appendPracticeEvaluation(
    evaluation: PracticeEvaluation,
  ): void {
    if (!this.agentCursorEl) return;

    const card = createNoxSurface(
      this.agentCursorEl,
      `nox-practice-evaluation nox-outcome--${evaluation.outcome}`,
    );

    const outcomeLabel =
      evaluation.outcome === "correct"
        ? "Correct"
        : evaluation.outcome === "partial"
          ? "Partial"
          : "Needs work";

    card.createDiv({
      cls: "nox-practice-label",
      text: `${outcomeLabel} · ${evaluation.concept}`,
    });
    card.createDiv({
      cls: "nox-practice-feedback",
      text: evaluation.feedback,
    });

    if (evaluation.misconceptions.length > 0) {
      const gaps = card.createDiv({
        cls: "nox-practice-gaps",
      });
      gaps.createDiv({
        cls: "nox-practice-gaps-label",
        text: "Gap",
      });

      for (const misconception of evaluation.misconceptions) {
        gaps.createDiv({
          cls: "nox-practice-gap",
          text: misconception,
        });
      }
    }

    this.scrollThread();
  }

  private appendReviewFindings(findings: ReviewFinding[]): void {
    if (!this.agentCursorEl) return;

    const wrap = this.agentCursorEl.createDiv({ cls: "nox-review" });
    wrap.createDiv({
      cls: "nox-review-summary",
      text: findings.length === 0
        ? "No material learning gaps found."
        : `${findings.length} important ${findings.length === 1 ? "gap" : "gaps"}`,
    });

    for (const finding of findings) {
      const card = createNoxSurface(
        wrap,
        `nox-review-card nox-review-card--${finding.kind}`,
      );
      card.createDiv({ cls: "nox-review-kind", text: finding.kind.replace("-", " ") });
      card.createDiv({ cls: "nox-review-title", text: finding.title });
      card.createDiv({ cls: "nox-review-detail", text: finding.detail });

      const actions = card.createDiv({ cls: "nox-review-actions" });
      const practice = createNoxButton(actions, {
        cls: "nox-review-action",
        variant: "quiet",
        text: "Practice",
      });
      practice.addEventListener("click", () => {
        this.setAction("practice");
        this.input.value = `Practice this gap: ${finding.concept} — ${finding.detail}`;
        this.onInput();
        this.input.focus();
      });

      const fix = createNoxButton(actions, {
        cls: "nox-review-action",
        variant: "quiet",
        text: "Fix",
      });
      fix.addEventListener("click", () => {
        this.setAction("edit");
        this.input.value = `Fix this learning gap: ${finding.detail}`;
        this.onInput();
        this.input.focus();
      });
    }

    this.scrollThread();
  }

  private appendProgressUpdate(
    topic: string | undefined,
    gaps: Array<{ status: string }>,
  ): void {
    if (!topic) return;
    const open = gaps.filter((gap) => gap.status === "open").length;
    const row = this.thread.createDiv({ cls: "nox-progress-row" });
    const mark = row.createSpan({ cls: "nox-progress-mark" });
    setNoxIcon(mark, "check");
    row.createSpan({
      cls: "nox-progress-text",
      text: open > 0
        ? `Learning state updated · ${open} open ${open === 1 ? "gap" : "gaps"}`
        : "Learning state updated",
    });
  }

  private appendProposalBubble(edit: ProposedEdit): void {
    const wrap = this.renderProposal(edit.proposal);
    this.appendProposalActions(wrap, edit);
    this.scrollThread();
  }

  private appendProposalActions(
    wrap: HTMLElement,
    edit: ProposedEdit,
  ): void {
    const proposal = edit.proposal;
    const actions = wrap.createDiv({
      cls: "nox-proposal-actions",
    });

    const rejectBtn = createNoxButton(actions, {
      cls: "nox-btn-reject",
      variant: "secondary",
      text: "Reject",
    });

    const applyBtn = createNoxButton(actions, {
      cls: "nox-btn-apply",
      variant: "primary",
      text: "Apply ✓",
    });

    rejectBtn.addEventListener("click", () => {
      void this.learning.rejectProposal(edit.id);
      actions.remove();
      createNoxStatus(wrap, {
        cls: "nox-result-badge nox-badge--rejected",
        kind: "neutral",
        text: "✕ Rejected",
      });
      this.setUIState("ANSWER");
    });

    applyBtn.addEventListener("click", async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = "Applying…";

      const result = await this.learning.applyProposal(edit.id);
      actions.remove();

      if (result.ok) {
        createNoxStatus(wrap, {
          cls: "nox-result-badge nox-badge--applied",
          kind: "success",
          text: "✓ Applied to " + proposal.file,
        });
        this.setUIState("APPLIED");
      } else {
        createNoxStatus(wrap, {
          cls: "nox-result-badge nox-badge--stale",
          kind: "warning",
          text: "⚠ " + result.message,
        });
        this.setUIState("ANSWER");
      }
    });
  }

  private renderProposal(proposal: EditProposal): HTMLElement {
    const wrap = createNoxSurface(this.thread, "nox-proposal", "approval");
    wrap.createDiv({
      cls: "nox-proposal-badge",
      text: "📄 " + proposal.file,
    });
    if (proposal.reason) {
      wrap.createDiv({ cls: "nox-proposal-reason", text: proposal.reason });
    }
    const diff = wrap.createDiv({ cls: "nox-proposal-diff" });
    proposal.original.split("\n").forEach((line) => {
      diff.createDiv({ cls: "nox-diff-removed", text: "- " + line });
    });
    proposal.replacement.split("\n").forEach((line) => {
      diff.createDiv({ cls: "nox-diff-added", text: "+ " + line });
    });
    return wrap;
  }

  private appendInlineStatus(
    parent: HTMLElement,
    kind: "stopped" | "failed",
    message: string,
    retry?: () => void,
  ): void {
    createNoxStatus(parent, {
      cls: `nox-inline-status nox-inline-status--${kind}`,
      kind: kind === "failed" ? "error" : "neutral",
      text: kind === "failed" ? "⚠ " + message : message,
      action: retry
        ? {
            cls: "nox-inline-status-retry",
            label: "Retry",
            onClick: retry,
          }
        : undefined,
    });

    this.scrollThread();
  }

  private isNearThreadBottom(): boolean {
    const distance =
      this.thread.scrollHeight -
      this.thread.scrollTop -
      this.thread.clientHeight;

    return distance < 48;
  }

  private scrollThread(behavior: ScrollBehavior = "smooth"): void {
    this.thread.scrollTo({
      top: this.thread.scrollHeight,
      behavior,
    });
  }
}
