import { renderLearningActivity } from "./activity-heatmap";
import { OnboardingFlow } from "./onboarding-flow";
import {
  ItemView,
  Notice,
  Modal,
  MarkdownRenderer,
  WorkspaceLeaf,
  type IconName,
} from "obsidian";
import { LearningController } from "../application/LearningController";
import {
  LearningActionKind,
  LearningEvent,
  LearningRequest,
  ProposedEdit,
} from "../application/learning-types";
import {
  ExplicitContextRef,
  LearningContext,
} from "../context/context-types";
import {
  PracticeAnswer,
  PracticeEvaluation,
  PracticeQuestion,
} from "../domain/practice/types";
import { ReviewFinding } from "../domain/review/types";
import { PracticePresenter } from "../features/practice/view/PracticePresenter";
import { renderReviewFindingCards } from "./learning-card-renderers";
import { ChatMessage, EditProposal, type ChatReplyReference } from "../types";
import { parsePromptToken, stripPromptToken } from "./prompt-token";
import { NOX_CAPABILITIES } from "./capabilities";
import { buildActionMenu, getPrimaryAction, type ActionMenuContext, type ActionMenuEntry } from "./action-menu";
import { animateNoxEnter } from "./motion";
import { resolveNoxMarkdownLink } from "./markdown-links";
import {
  shouldResetAction,
  TerminalOutcome,
} from "./chat-state";
import {
  createNoxButton,
  createNoxIconButton,
  createNoxMessageMeta,
  createNoxSurface,
  createNoxStatus,
  setNoxIcon,
} from "./primitives";
import { HistoryPresenter } from "../features/conversation/view/history-presenter";
import { renderResponseActions } from "../features/conversation/view/response-actions-presenter";
import { StreamTextPresenter } from "../features/conversation/view/stream-text-presenter";
import { projectSessionClock } from "../features/conversation/view/session-clock";
import { TranscriptPresenter } from "../features/conversation/view/transcript-presenter";
import { ModelMenuPresenter } from "./model-menu";
import { createNoxPopover } from "./popover";
import { PromptMenuPresenter, type PromptMenuItem } from "./prompt-menu-presenter";
import { NoxComposer, type NoxComposerContext } from "./composer";
import { NoxRunInspector } from "./run-inspector";
import { appendMessageActions } from "./message-actions";
import { TranscriptSelectionController } from "./transcript-selection";
import { renderLearningGraph } from "./learning-graph";
import { LearningPresenter } from "../features/learning/view/LearningPresenter";
import { enhanceNoxResponseVisuals } from "./response-visuals";
import {
  NoxSelectionActions,
  type NoxSelectionAction,
} from "./selection-actions";

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

export class ChatView extends ItemView {
  private thread!: HTMLElement;
  private composer!: HTMLElement;
  private composerUi!: NoxComposer;
  private selectionActions!: NoxSelectionActions;
  private transcriptSelection: TranscriptSelectionController | null = null;
  private pendingReplyTo: ChatReplyReference | null = null;
  private readonly transcriptPresenter = new TranscriptPresenter(() =>
    new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())));
  private headerEl!: HTMLElement;
  private historyBtn!: HTMLButtonElement;
  private historyMenuEl!: HTMLElement;
  private historyPresenter!: HistoryPresenter;

  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private cancelBtn!: HTMLButtonElement;
  private modelUi: ModelMenuPresenter | null = null;
  private readonly practiceUi: PracticePresenter;
  private readonly learningUi: LearningPresenter;
  private fileInput!: HTMLInputElement;
  private actionMenuBtn!: HTMLButtonElement;
  private promptUi: PromptMenuPresenter | null = null;
  private commandProgramSnapshot: Awaited<ReturnType<LearningController["getProgramMenuState"]>> | null = null;
  private scopeGoal: { sessionId: string; programId: string; goal: string } | null = null;
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
  private lastAgentActivityAt = 0;
  private sessionClockEl: HTMLElement | null = null;
  private sessionClockTextEl: HTMLElement | null = null;
  private sessionClockButtonEl: HTMLButtonElement | null = null;
  private thinkingToggleEl: HTMLButtonElement | null = null;
  private thinkingLabelEl: HTMLElement | null = null;
  private thinkingChevronEl: HTMLElement | null = null;
  private thinkingPanelEl: HTMLElement | null = null;
  private thinkingThoughtEl: HTMLElement | null = null;
  private thinkingRows = new Map<number, HTMLElement>();
  private thinkingToolRows = new Map<string, HTMLElement>();
  private thinkingListEl: HTMLElement | null = null;
  private thinkingViewportEl: HTMLElement | null = null;
  private thinkingStage = -1;
  private thinkingStageAt = 0;
  private readonly streamText = new StreamTextPresenter({
    request: callback => window.requestAnimationFrame(callback),
    cancel: id => window.cancelAnimationFrame(id),
  });
  private runInspector: NoxRunInspector | null = null;
  private focusStripEl: HTMLButtonElement | null = null;
  private thinkingManualExpanded: boolean | null = null;
  private streamedThoughtText = "";

  private uiState: UIState = "EMPTY";
  private selectedAction: LearningActionKind = "ask";
  private runningAction: LearningActionKind | null = null;
  private capabilityCards = new Map<LearningActionKind, HTMLButtonElement>();
  private systemContextFiles: string[] = [];
  private lastTurnRequest: LearningRequest | null = null;
  private turnTerminal = false;
  /** Guards the async gap while pending Practice edits are flushed before a new turn. */
  private turnStarting = false;
  /** Invalidates in-flight admission after session change or view close/reopen. */
  private viewEpoch = 0;
  private restoringSession = false;
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
    this.practiceUi = new PracticePresenter({
      session: () => this.learning.getSession(),
      hasActiveQuestion: () => this.learning.hasActivePracticeQuestion(),
      isBusy: () => this.uiState === "RUNNING",
      saveDraft: async (questionId, answer, sessionId) => {
        if (this.learning.getSession().id !== sessionId) return;
        await this.learning.savePracticeDraft(questionId, answer);
      },
      requestHint: (question, sessionId) => this.requestPracticeHint(question, sessionId),
      submit: (questionId, answer, sessionId) => this.submitPracticeAnswer(questionId, answer, sessionId),
      clarify: () => {
        this.setAction("ask");
        this.input.value = "/clarify ";
        this.onInput();
        this.input.focus();
      },
      prepareContinue: (evaluation, sessionId) => this.prepareNextPracticeActivity(evaluation, sessionId),
      reportError: message => { new Notice(message); },
    });
    this.learningUi = new LearningPresenter({
      thread: () => this.thread,
      overview: () => this.learning.getProgramOverview(),
      activity: async scope => {
        const state = await this.learning.getProgramMenuState();
        return this.learning.getActivitySummary(scope === "active" ? state.activeProgramId : undefined);
      },
      readClock: () => this.learning.getSessionTime(),
      projectClock: projectSessionClock,
      mountMap: (overview, onClose, onNext, onCommand) =>
        renderLearningGraph(this.thread, overview, onClose, onNext, onCommand),
      mountActivity: (summary, scope, onClose, onScopeChange) =>
        renderLearningActivity(this.thread, summary, { scope, onClose, onScopeChange }),
      onNext: overview => {
        if (this.uiState === "RUNNING") return;
        this.input.value = overview?.focus?.status === "paused" ? "/resume-focus" :
          overview?.active ? "/next" : overview?.next.objectiveId
            ? "/focus " + overview.next.objectiveId : overview ? "/progress" : "/plan ";
        this.onInput();
        if (overview) void this.doSend(); else this.focusComposer();
      },
      onCommand: command => this.submitLearningPanelCommand(command),
      reportError: message => { new Notice(message); },
    });
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
    ++this.viewEpoch;
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
    this.transcriptSelection = new TranscriptSelectionController(root, this.thread, reference => {
      if (this.uiState === "RUNNING" ||
          reference.sourceSessionId !== this.learning.getSession().id) return;
      if (this.learning.isActiveLearningScope(this.learning.getSession().learningScope)) {
        new Notice("Pause the assessment before asking about a chat quote.");
        return;
      }
      this.pendingReplyTo = reference;
      this.composerUi.setReplyReference(reference);
      this.setAction("ask");
      this.focusComposer();
    });

    // Local transcripts remain available even if the runtime is offline.
    await this.restoreRuntimeState();
    await this.ensureRuntimeReady();
    void this.refreshFocusStrip();
    this.learningUi.startClock(this.sessionClockEl!, this.sessionClockTextEl!, this.sessionClockButtonEl!);
    void this.refreshSessionClock();
  }

  async onClose(): Promise<void> {
    ++this.viewEpoch;
    try {
      await this.practiceUi.flushDraft();
    } catch {
      new Notice("Could not save quiz draft before closing Nox.");
    }
    this.learning.cancel();
    this.learningUi.dispose();
    this.transcriptPresenter.cancel();
    this.streamText.dispose();
    this.historyPresenter?.close();
    this.transcriptSelection?.destroy();
    this.transcriptSelection = null;
    this.stopLoadingTimer();
    this.practiceUi.dispose();
    this.modelUi?.dispose();
    this.modelUi = null;
    this.promptUi?.dispose();
    this.promptUi = null;
  }

  async refreshRuntime(recheckHealth = true): Promise<void> {
    if (recheckHealth) {
      this.runtimeReady = false;
      this.setUIState(this.uiState);
    }
    await this.refreshModelList();
    if (recheckHealth) await this.ensureRuntimeReady(true);
  }

  private async ensureRuntimeReady(preserveState = false): Promise<boolean> {
    try {
      const health = await this.learning.checkRuntime();
      if (health.status === "ready") {
        this.runtimeReady = true;
        this.runtimeFailureMessage = null;
        this.thread.querySelector(".nox-runtime-error")?.remove();
        if (this.uiState !== "RUNNING") {
          this.setUIState(preserveState && this.uiState !== "ERROR" ? this.uiState
            : this.learning.getSession().messages.length ? "ANSWER" : "EMPTY");
        }
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
    if (this.uiState !== "RUNNING") this.setUIState("ERROR");
  }

  private async restoreRuntimeState(): Promise<void> {
    await this.syncChips();
    this.syncPracticeComposerState();
    await this.restoreSession();
    void this.showPendingOnboardingRecovery();
    void this.refreshFocusStrip();

    if (!this.workspaceEventsRegistered) {
      this.workspaceEventsRegistered = true;
      this.registerEvent(
        this.app.workspace.on("active-leaf-change", () => {
          void this.syncChips().catch(error => console.warn("[Nox] Could not synchronize note context", error));
        }),
      );
      this.registerEvent(
        (this.app.workspace as typeof this.app.workspace & {
          on(name: "editor-selection-change", callback: () => void): import("obsidian").EventRef;
        }).on("editor-selection-change", () => {
          void this.syncChips().catch(error => console.warn("[Nox] Selection sync failed", error));
        }),
      );
    }

    void this.refreshModelList().catch(error => console.warn("[Nox] Model refresh failed", error));
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

  /** Explicit command-palette entry to revisit guided discovery after skipping. */
  async beginGuidedOnboarding(): Promise<void> {
    if (this.turnStarting || this.uiState === "RUNNING") {
      throw new Error("Finish the active turn before restarting onboarding.");
    }
    await this.practiceUi.flushDraft();
    await this.learning.newSession();
    this.invalidateSessionPresentation();
    await this.learning.reopenOnboarding();
    this.clearSessionBoundDraft();
    this.input.value = "";
    this.setAction("ask");
    this.showEmpty();
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
    const mapBtn = createNoxIconButton(right, { cls: "nox-map-btn", icon: "git-branch", label: "Open learning map", title: "Learning map" });
    mapBtn.addEventListener("click", () => void this.toggleLearningMap());
    const activityBtn = createNoxIconButton(right, {
      cls: "nox-activity-btn", icon: "chart-no-axes-column",
      label: "Open learning activity", title: "Learning activity",
    });
    activityBtn.addEventListener("click", () => void this.toggleLearningActivity());

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
      if (event.key === "Escape" && this.historyPresenter?.isOpen) {
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
    newBtn.addEventListener("click", () => { void (async () => {
      if (this.uiState === "RUNNING" || this.turnStarting) return;
      try {
        await this.practiceUi.flushDraft();
        await this.learning.newSession();
        this.invalidateSessionPresentation();
        this.clearSessionBoundDraft();
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
    })().catch(error => console.warn("[Nox] UI action failed", error)); });

    const moreBtn = createNoxIconButton(right, {
      cls: "nox-more-btn",
      icon: "more-horizontal",
      label: "Open Nox settings",
      title: "Nox settings",
    });
    moreBtn.addEventListener("click", () => this.openSettings());

    this.focusStripEl = this.headerEl.createEl("button", {
      cls: "nox-focus-strip nox-hidden",
      attr: { type: "button", "aria-label": "Open active learning focus" },
    });
    this.focusStripEl.addEventListener("click", () => {
      if (!this.learningUi.hasMap) void this.toggleLearningMap();
    });
    this.sessionClockEl = this.headerEl.createDiv({ cls: "nox-session-clock nox-hidden" });
    this.sessionClockEl.setAttribute("role", "group");
    this.sessionClockEl.setAttribute("aria-label", "Learning session timer");
    this.sessionClockTextEl = this.sessionClockEl.createSpan({ cls: "nox-session-clock-label" });
    this.sessionClockButtonEl = this.sessionClockEl.createEl("button", {
      cls: "nox-session-clock-button",
      attr: { type: "button" },
    });
    this.sessionClockButtonEl.addEventListener("click", () => { void (async () => {
      if (!this.sessionClockButtonEl || this.sessionClockButtonEl.disabled) return;
      const paused = this.sessionClockButtonEl.dataset.action === "pause";
      this.sessionClockButtonEl.disabled = true;
      try {
        await this.learning.setSessionPaused(paused);
        await this.refreshSessionClock();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Could not update session time.");
      } finally {
        if (this.sessionClockButtonEl) this.sessionClockButtonEl.disabled = false;
      }
    })().catch(error => console.warn("[Nox] UI action failed", error)); });

    this.historyMenuEl = createNoxPopover(this.headerEl, {
      cls: "nox-history-menu",
      id: "nox-history-menu",
      role: "dialog",
      label: "Chat history",
    });
    this.historyPresenter = new HistoryPresenter(this.historyBtn, this.historyMenuEl, {
      open: id => this.selectHistorySession(id),
      mutate: async (ids, action) => {
        if (this.turnStarting || this.uiState === "RUNNING") {
          throw new Error("Finish the active turn before modifying history.");
        }
        await this.practiceUi.flushDraft();
        const result = await this.learning.mutateHistory(ids, action);
        if (result.activeSessionChanged) {
          this.invalidateSessionPresentation();
          this.clearSessionBoundDraft();
          this.syncPracticeComposerState();
          await this.syncChips();
          await this.restoreSession();
        }
        this.renderHistoryMenu();
        if (result.affected > 0) new Notice(
          `${result.affected} conversation${result.affected === 1 ? "" : "s"} ${action === "archive" ? "archived" : action === "restore" ? "restored" : "deleted"}.`,
        );
      },
      confirmDelete: count => this.confirmHistoryDeletion(count),
    }, () => ({ sessions: this.learning.listSessions(true), activeId: this.learning.getSession().id }));
    this.historyMenuEl.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeHistoryMenu();
        this.historyBtn.focus();
      }
    });
    this.historyPresenter.render();
  }

  private async refreshSessionClock(): Promise<void> {
    await this.learningUi.refreshClock();
  }

  private async toggleLearningActivity(scope: "active" | "all" = "active"): Promise<void> {
    await this.learningUi.toggleActivity(scope);
  }

  private async refreshFocusStrip(): Promise<void> {
    await this.learningUi.refreshFocusStrip(this.focusStripEl);
  }

  private submitLearningPanelCommand(command: string): void {
    if (this.uiState === "RUNNING" || this.pendingReplyTo) return;
    if (!this.learning.canExecuteOfflineCommand(command) && command !== "/next") return;
    this.learningUi.closeMap();
    this.setAction("ask");
    this.input.value = command;
    this.onInput();
    void this.doSend();
  }

  private async toggleLearningMap(): Promise<void> {
    await this.learningUi.toggleMap();
  }

  private toggleHistoryMenu(): void {
    this.historyPresenter.toggle(() => {
      this.closePromptMenu();
      this.closeModelMenu();
    });
  }

  private closeHistoryMenu(): void {
    this.historyPresenter?.close();
  }

  private renderHistoryMenu(): void {
    this.historyPresenter?.render();
  }

  private confirmHistoryDeletion(count: number): Promise<boolean> {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      modal.modalEl.addClass("nox-theme-portal");
      let settled = false;
      const finish = (confirmed: boolean) => {
        if (settled) return;
        settled = true;
        modal.close();
        resolve(confirmed);
      };
      modal.titleEl.setText("Delete conversations?");
      modal.contentEl.createEl("p", {
        text: `Delete ${count} conversation${count === 1 ? "" : "s"} from this vault? This cannot be undone.`,
      });
      const actions = modal.contentEl.createDiv({ cls: "nox-history-confirm-actions" });
      const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
      cancel.addEventListener("click", () => finish(false));
      const remove = actions.createEl("button", {
        text: "Delete",
        cls: "mod-warning",
        attr: { type: "button" },
      });
      remove.addEventListener("click", () => finish(true));
      modal.onClose = () => finish(false);
      modal.open();
      cancel.focus();
    });
  }

  /** The same practice projection is used after startup and history navigation. */
  private syncPracticeComposerState(): void {
    const active = this.learning.hasActivePracticeQuestion();
    this.setAction(active ? "practice" : "ask");
    this.pinFindingSource(
      active ? this.learning.getActivePracticeOrigin()?.file ?? null : null,
    );
  }

  private clearReplyReference(): void {
    this.pendingReplyTo = null;
    this.composerUi?.setReplyReference(null);
  }

  /** Shell-only cross-feature invalidation; presenters keep their own timers and overlays. */
  private invalidateSessionPresentation(): void {
    ++this.viewEpoch;
    this.practiceUi.reset();
    this.learningUi.reset();
    this.transcriptPresenter.cancel();
  }

  private clearSessionBoundDraft(): void {
    this.clearReplyReference();
    this.transcriptSelection?.hide();
    this.lastTurnRequest = null;
    this.pendingFindingSource = null;
    this.systemContextFiles = [];
    this.extraCtx = [];
    this.attachments = [];
    this.renderAttachments();
    this.closePromptMenu();
    this.closeModelMenu();
  }


  private async forkMessage(messageId: string): Promise<void> {
    if (this.uiState === "RUNNING" || this.turnStarting) return;
    if (this.input.value.trim()) {
      new Notice("Clear or send the composer draft before forking.");
      return;
    }
    await this.practiceUi.flushDraft();
    const originSessionId = this.learning.getSession().id;
    const result = await this.learning.forkSession(originSessionId, messageId);
    await this.selectHistorySession(result.session.id);
    if (result.draftReplyTo) {
      this.pendingReplyTo = result.draftReplyTo;
      this.composerUi.setReplyReference(result.draftReplyTo);
      this.setAction("ask");
    }
    if (result.draftUserPrompt !== undefined) {
      this.input.value = result.draftUserPrompt;
      this.onInput();
    }
  }

  private async selectHistorySession(id: string): Promise<void> {
    if (this.uiState === "RUNNING" || this.turnStarting) return;

    await this.practiceUi.flushDraft();
    const session = await this.learning.selectSession(id);
    if (!session) return;
    this.invalidateSessionPresentation();

    this.closeHistoryMenu();
    this.clearSessionBoundDraft();
    this.input.value = "";
    this.composerUi.syncInputLayout();
    this.syncPracticeComposerState();
    await this.syncChips();
    await this.restoreSession();
    if (!this.runtimeReady && this.runtimeFailureMessage) {
      this.showRuntimeError(this.runtimeFailureMessage);
    }
    this.focusComposer();
  }

  private async refreshModelList(): Promise<void> {
    this.modelUi?.refresh();
  }

  private closeModelMenu(): void {
    this.modelUi?.close();
  }

  private toggleModelMenu(): void {
    this.modelUi?.toggle();
  }

  private onModelTriggerKey(event: KeyboardEvent): void {
    this.modelUi?.onTriggerKey(event);
  }

  private buildComposer(parent: HTMLElement): void {
    this.composerUi = new NoxComposer(parent, {
      onInput: () => this.onInput(),
      onKeyDown: (event) => this.onKey(event),
      onFiles: (files) => void this.handleFiles(files),
      onOpenFilePicker: () => {
        // The + control attaches real user-selected text files. Keep typed
        // @note source search and / slash commands on their existing paths.
        this.closeModelMenu();
        this.closePromptMenu();
        this.fileInput.click();
      },
      onOpenCommandMenu: () => {
        this.closeModelMenu();
        this.promptUi?.toggleCommand();
        this.composerUi.focus();
      },
      onToggleModelMenu: () => this.toggleModelMenu(),
      onModelKeyDown: (event) => this.onModelTriggerKey(event),
      onCancel: () => {
        this.learning.cancel();
        this.composerUi.cancelBtn.disabled = true;
      },
      onSend: () => void this.doSend(),
      onRemoveReply: () => this.clearReplyReference(),
    });

    this.input = this.composerUi.input;
    this.fileInput = this.composerUi.fileInput;
    this.actionMenuBtn = this.composerUi.actionMenuBtn;

    this.cancelBtn = this.composerUi.cancelBtn;
    this.sendBtn = this.composerUi.sendBtn;
    this.modelUi = new ModelMenuPresenter(
      this.composerUi.modelTrigger,
      this.composerUi.modelMenuEl,
      this.composerUi.modelPopover,
      {
        models: () => this.learning.getModels(),
        selectedId: () => this.learning.getSession().model,
        discoveryError: () => this.learning.getModelDiscoveryError(),
        discover: () => this.learning.refreshModels(),
        select: id => this.learning.setModel(id || undefined),
        setLabel: label => this.composerUi.setModelLabel(label),
        beforeOpen: () => this.closePromptMenu(),
        reportError: message => { new Notice(message); },
      },
    );
    this.promptUi = new PromptMenuPresenter(
      this.composerUi.input,
      this.composerUi.promptMenuEl,
      this.composerUi.promptPopover,
      this.composerUi.actionMenuBtn,
      {
        items: (kind, page) => this.getPromptMenuItems(kind, page),
        select: item => this.pickPromptMenuItem(item),
        invalidate: () => { this.commandProgramSnapshot = null; },
        reportError: message => { new Notice(message); },
      },
    );
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

  private toActionMenuContext(programState: Awaited<ReturnType<LearningController["getProgramMenuState"]>>): ActionMenuContext {
    const scope = this.learning.getSession().learningScope;
    return {
      activeProgramId: programState.activeProgramId,
      hasActiveSession: programState.sessionActive,
      savedProgramCount: programState.programs.length,
      hasPracticeQuestion: this.learning.hasActivePracticeQuestion(),
      legacyMode: this.learning.isActiveLearningScope(scope) ? "locked"
        : scope?.resumeMode ? "paused" : "free",
    };
  }

  private async getPromptMenuItems(kind: "command" | "source", page: "actions" | "programs"): Promise<PromptMenuItem[]> {
    if (kind === "command") {
      let programState: Awaited<ReturnType<LearningController["getProgramMenuState"]>>;
      try {
        programState = this.commandProgramSnapshot ??
          await this.learning.getProgramMenuState();
        this.commandProgramSnapshot = programState;
      } catch {
        // The ordinary note actions remain usable when the vault program index is unavailable.
        programState = { sessionActive: false, programs: [] };
      }

      if (page === "programs") {
        return [
          { key: "back", name: "Back to actions", description: "Return to the main menu",
            icon: "arrow-left", action: { type: "menu-back" } },
          ...programState.programs.map(item => ({
            key: `program:${item.id}`,
            name: item.goal,
            description: item.id === programState.activeProgramId
              ? "Current learning program" : "Switch to this program",
            icon: "book-open" as IconName,
            action: { type: "switch-program" as const, id: item.id },
          })),
          { key: "new-plan", name: "Create another plan", description: "Set a new learning goal",
            icon: "plus", command: "/plan ", action: { type: "scope", command: "/plan " } },
        ];
      }

      const context = this.toActionMenuContext(programState);
      const token = parsePromptToken(this.input.value);
      const query = token?.kind === "command" ? token.query : "";
      return buildActionMenu(context, query).map(item => ({
        key: item.key,
        name: item.name,
        description: item.description,
        icon: item.icon,
        command: item.command,
        action: item.action,
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
    if (action.type === "switch-program") {
      if (this.uiState === "RUNNING") return;
      this.setAction("ask");
      this.input.value = `/use-program ${action.id}`;
      this.closePromptMenu();
      this.onInput();
      await this.doSend();
      return;
    }
    if (action.type === "scope") {
      if (action.command.startsWith("/research")) this.setAction("ask");
      this.input.value = action.command;
      this.closePromptMenu();
      this.onInput();
      this.input.focus();
      return;
    }

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
    this.promptUi?.close();
  }

  private setAction(action: LearningActionKind): void {
    if (this.learning.isActiveLearningScope(this.learning.getSession().learningScope)) action = "practice";
    const changed = action !== this.selectedAction;
    this.selectedAction = action;
    if (changed && this.pendingFindingSource) {
      this.pendingFindingSource = null;
      this.syncContextChips();
    }
    this.promptUi?.resetSelection();
    this.updatePlaceholder();
    this.renderIntent();
    this.syncCapabilityCards();
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

  /** A read-only UI projection: never make the view read a vault repository directly. */
  private async refreshScopeGoal(): Promise<void> {
    const session = this.learning.getSession();
    const scope = session.learningScope;
    if (!this.learning.isProgramLearningScope(scope)) {
      this.scopeGoal = null;
      this.renderIntent();
      return;
    }
    try {
      const state = await this.learning.getProgramMenuState();
      const current = this.learning.getSession();
      if (current.id !== session.id || !this.learning.isProgramLearningScope(current.learningScope) ||
          current.learningScope.programId !== scope.programId) return;
      const goal = state.programs.find(item => item.id === scope.programId)?.goal;
      this.scopeGoal = goal ? { sessionId: session.id, programId: scope.programId, goal } : null;
      this.renderIntent();
      this.updatePlaceholder();
    } catch {
      this.scopeGoal = null;
      this.renderIntent();
    }
  }

  private renderIntent(): void {
    const session = this.learning.getSession();
    const scope = session.learningScope;
    const program = this.learning.isProgramLearningScope(scope);
    const locked = this.learning.isActiveLearningScope(scope);
    const title = program && this.scopeGoal?.sessionId === session.id &&
      this.scopeGoal.programId === scope.programId ? this.scopeGoal.goal : "Learning program";
    const label = program
      ? locked ? `${title} · ${scope.mode === "ASSESSMENT" ? "Assessment" : "Focused"}`
        : scope.resumeMode && this.selectedAction === "ask" ? `${title} · Paused` : null
      : locked ? scope?.mode === "BASELINE_ASSESSMENT" ? "Backend · Legacy Assessment" : "Backend · Legacy Focused"
      : scope?.resumeMode && this.selectedAction === "ask" ? "Backend · Paused"
      : this.selectedAction === "ask" ? null
      : ACTIONS.find((item) => item.kind === this.selectedAction)?.label ?? this.selectedAction;
    const chip = this.composerUi.setIntent(
      label,
      `nox-intent-chip--${this.selectedAction}`,
      () => {
        if (locked || scope?.resumeMode) {
          this.input.value = locked ? "/pause" : "/resume";
          this.onInput();
          this.composerUi.focus();
          return;
        }
        this.setAction("ask");
        this.composerUi.focus();
      },
    );
    if (chip) {
      if (locked || scope?.resumeMode) {
        chip.title = locked ? "Type /pause or /mode free to leave the learning scope." : "Type /resume to resume learning.";
        const control = chip.querySelector("button");
        control?.setAttribute("aria-label", locked ? "Prepare /pause command" : "Prepare /resume command");
      }
      animateNoxEnter(chip, 3);
    }
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
      this.input.placeholder = this.learning.isActiveLearningScope(this.learning.getSession().learningScope)
        ? "Answer or clarify the current question · /pause to leave"
        : placeholders[this.selectedAction];
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
    void this.refreshScopeGoal();

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
    const pinned = this.pendingFindingSource &&
      (this.selectedAction === "practice" || this.selectedAction === "edit")
        ? this.pendingFindingSource
        : null;
    const automaticPath = selection?.file ?? this.currentContext?.activeNote?.path;
    if (pinned && pinned !== automaticPath) {
      contexts.push({
        key: "review-source",
        text: `@${pinned.split("/").pop() ?? pinned}`,
        title: `Pinned review source: ${pinned}`,
        icon: "file-text",
      });
    } else if (selection) {
      contexts.push({
        key: "selection",
        text: "@selection",
        title: selection.file,
        icon: "file-text",
      });
    }

    const activeNote = this.currentContext?.activeNote;
    if (!selection && activeNote && !(pinned && pinned !== automaticPath)) {
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
      this.canSend() && this.uiState !== "RUNNING",
    );

    // An exact mode command is submitted with Enter, not replaced by a menu row.
    if (this.learning.isScopeCommand(this.input.value)) {
      this.closePromptMenu();
      return;
    }

    this.promptUi?.onInput();
  }

  private onKey(event: KeyboardEvent): void {
    if (this.promptUi?.onKey(event)) return;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!this.sendBtn.disabled) void this.doSend();
    }

    if (event.key === "Escape") {
      if (this.promptUi?.isOpen) {
        this.closePromptMenu();
      } else if (this.modelUi?.isOpen) {
        this.closeModelMenu();
      } else if (this.historyPresenter?.isOpen) {
        this.closeHistoryMenu();
      } else if (this.uiState === "RUNNING") {
        this.cancelBtn.click();
      }
    }
  }

  private async doSend(): Promise<void> {
    const prompt = this.input.value.trim() || "Review the attached context.";
    if (!this.canSend() || this.uiState === "RUNNING" || this.turnStarting) return;
    if (this.pendingReplyTo && prompt.startsWith("/")) {
      new Notice("Remove the quoted response before running a command.");
      return;
    }

    this.closeModelMenu();
    const request: LearningRequest = {
      turnId: crypto.randomUUID(),
      prompt,
      action: this.selectedAction,
      explicitContext: [...this.extraCtx],
      ...(this.pendingReplyTo ? { replyTo: structuredClone(this.pendingReplyTo) } : {}),
      sourcePath: (this.selectedAction === "edit" || this.selectedAction === "practice")
        ? this.pendingFindingSource ?? undefined
        : undefined,
    };

    this.lastTurnRequest = request;
    await this.runTurn(request, true);
  }

  private async retryLastTurn(): Promise<void> {
    if (!this.lastTurnRequest || this.uiState === "RUNNING" || this.turnStarting) return;

    this.thread
      .querySelectorAll(".nox-inline-status--failed")
      .forEach((status) => status.remove());

    await this.runTurn(this.lastTurnRequest, false);
  }

  private async runTurn(
    request: LearningRequest,
    appendUserMessage: boolean,
  ): Promise<void> {
    // Admission must be synchronous: awaiting a draft flush cannot permit two sends.
    if (this.turnStarting || this.uiState === "RUNNING") return;
    this.turnStarting = true;
    const epoch = this.viewEpoch;
    try {
      // /hint, normal sends, retry and regenerate preserve the answer before inference.
      await this.practiceUi.flushDraft();
    } catch {
      if (epoch === this.viewEpoch) new Notice("Could not save the quiz draft. Retry before sending.");
      return;
    } finally {
      this.turnStarting = false;
    }
    if (epoch !== this.viewEpoch) return;
    this.closePromptMenu();
    this.clearReplyReference();

    this.input.value = "";
    this.composerUi.syncInputLayout();
    this.attachments = [];
    this.extraCtx = [];
    this.renderAttachments();
    this.sendBtn.disabled = true;

    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.statusEl = null;
    this.streamedThoughtText = "";
    this.thinkingThoughtEl = null;
    this.streamText.reset();
    this.thinkingStage = -1;
    this.thinkingRows.clear();
    this.thinkingToolRows.clear();
    this.thinkingListEl = null;
    this.thinkingViewportEl = null;
    this.thinkingManualExpanded = null;
    this.stopLoadingTimer();
    this.runInspector = null;
    this.turnTerminal = false;

    this.runningAction = request.action;
    this.lastAgentActivityAt = Date.now();
    this.turnContextSource = null;
    if (appendUserMessage) this.appendUserBubble(request.prompt, request.turnId, request.replyTo);
    this.setUIState("RUNNING");
    this.ensureThinkingTrace();

    try {
      let regenerated = false;
      const sessionId = this.learning.getSession().id;
      for await (const event of this.learning.run({
        ...request,
        retry: !appendUserMessage && !request.regenerate,
      })) {
        if (event.type === "completed") regenerated = true;
        this.handleLearningEvent(event);
      }
      // Drop the provisional streaming bubble only after the new version is
      // durable. A failure leaves the original response intact.
      if (request.regenerate && regenerated && this.learning.getSession().id === sessionId) {
        await this.restoreSession();
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
    if (event.type === "activity-phase") {
      if (event.phase === "waiting-model") this.setThinkingStage(2);
      else if (event.phase === "receiving-output") this.setThinkingStage(3);
      else this.setThinkingStage(4);
      this.lastAgentActivityAt = Date.now();
      return;
    }
    if (event.type === "tool-started") {
      this.lastAgentActivityAt = Date.now();
      this.runInspector?.toolStarted(event.toolCallId, event.name);
      this.appendThinkingTool(event.toolCallId, event.name);
      return;
    }
    if (event.type === "tool-completed") {
      this.lastAgentActivityAt = Date.now();
      this.runInspector?.toolCompleted(event.toolCallId, event.outcome);
      this.completeThinkingTool(event.toolCallId, event.outcome);
      return;
    }
    if (event.type === "context-ready") {
      this.runInspector?.setContext(event.context);
      this.currentContext = event.context.resolved;
      this.turnContextSource =
        event.context.mutableFile ??
        event.context.resolved.selection?.file ??
        event.context.resolved.activeNote?.path ?? null;
      if (this.runningAction === "practice") {
        this.pinFindingSource(this.turnContextSource);
      }
      this.systemContextFiles = event.context.system.map((item) => item.file);
      this.syncContextChips();
      this.setThinkingStage(1);
      return;
    }

    if (event.type === "thought-delta") {
      this.lastAgentActivityAt = Date.now();
      const shouldFollow = this.isNearThreadBottom();
      this.setThinkingStage(3);
      this.appendThoughtText(event.text);
      if (shouldFollow) this.scrollThread("auto");
      return;
    }

    if (event.type === "response-delta") {
      this.lastAgentActivityAt = Date.now();
      const shouldFollow = this.isNearThreadBottom();
      this.setThinkingStage(3);
      this.appendToAgentBubble(event.text);
      if (shouldFollow) this.scrollThread("auto");
      return;
    }

    if (event.type === "practice-question") {
      this.setAction("practice");
      this.setThinkingStage(3);
      this.ensureAgentBubble();
      this.appendPracticeQuestion(event.question, this.agentCursorEl, event.questionId);
      return;
    }

    if (event.type === "practice-evaluation") {
      this.setThinkingStage(3);
      this.ensureAgentBubble();
      this.appendPracticeEvaluation(event.evaluation, this.agentCursorEl, event.questionId);
      return;
    }

    if (event.type === "review-findings") {
      this.setThinkingStage(3);
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
    void this.refreshSessionClock();
    this.runInspector?.settle(outcome);

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
    void this.refreshScopeGoal();
    void this.refreshFocusStrip();
    if (this.learning.hasActivePracticeQuestion() || this.learning.getSession().learningScope) {
      this.syncPracticeComposerState();
    }
  }

  private finishStreamingBubble(doneLabel?: string): void {
    const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
    this.flushStreamingText();
    this.renderMarkdownResponse();
    if (doneLabel === undefined) this.appendStreamActions();
    const defaultLabel = `Completed in ${elapsed}`;
    this.settleThinking(doneLabel ?? defaultLabel);
    this.stopLoadingTimer();
    this.agentCursorEl?.removeClass("nox-bubble--streaming");
    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.statusEl = null;
    this.thinkingToggleEl = null;
    this.thinkingLabelEl = null;
    this.thinkingChevronEl = null;
    this.thinkingPanelEl = null;
    this.thinkingThoughtEl = null;
    this.thinkingRows.clear();
    this.thinkingToolRows.clear();
    this.thinkingListEl = null;
    this.thinkingViewportEl = null;
    this.thinkingStage = -1;
    this.thinkingManualExpanded = null;
    this.streamText.detach();
    this.runInspector = null;
  }

  private settleThinking(doneLabel: string): void {
    if (!this.thinkingLabelEl) return;
    this.thinkingLabelEl.textContent = doneLabel;
    this.thinkingLabelEl.removeClass("nox-thinking-label--active");
    this.thinkingLabelEl.addClass("nox-thinking-label--done");

    const completed = doneLabel.startsWith("Completed");
    const active = this.thinkingRows.get(this.thinkingStage);
    if (active) {
      this.setThinkingRowStatus(active, completed ? "complete" : "interrupted");
      const time = active.querySelector<HTMLElement>(".nox-thinking-phase-time");
      if (time) time.textContent = this.formatElapsed(Date.now() - this.thinkingStageAt);
    }
    // Actual tool calls without terminal events are interrupted, never marked done.
    for (const row of this.thinkingToolRows.values()) {
      if (row.dataset.status === "running") {
        row.dataset.status = "interrupted";
        const marker = row.querySelector<HTMLElement>(".nox-thinking-marker");
        if (marker) setNoxIcon(marker, "minus");
        const meta = row.querySelector<HTMLElement>(".nox-thinking-phase-time");
        if (meta) meta.textContent = "Interrupted";
      }
    }

    this.statusEl?.removeClass("nox-thinking--working");
    this.statusEl?.addClass("nox-thinking--settled");
    // BeUI pattern: auto-disclose live activity, collapse on completion.
    this.updateThinkingDisclosure(this.thinkingManualExpanded ?? false);
  }

  private updateThinkingDisclosure(expanded: boolean): void {
    this.thinkingPanelEl?.toggleClass("is-expanded", expanded);
    this.thinkingToggleEl?.setAttribute("aria-expanded", String(expanded));
    this.thinkingChevronEl?.toggleClass("is-expanded", expanded);
  }

  private setThinkingRowStatus(row: HTMLElement, status: "active" | "complete" | "interrupted"): void {
    row.removeClass("is-active", "is-done", "is-interrupted");
    row.addClass(status === "active" ? "is-active" : status === "complete" ? "is-done" : "is-interrupted");
    row.dataset.status = status;
    const marker = row.querySelector<HTMLElement>(".nox-thinking-marker");
    if (!marker) return;
    marker.removeClass("nox-thinking-marker--spinner");
    marker.empty();
    if (status === "complete") setNoxIcon(marker, "check");
    else if (status === "interrupted") setNoxIcon(marker, "minus");
    else marker.addClass("nox-thinking-marker--spinner");
  }

  private setThinkingStage(activeIndex: number): void {
    if (!this.thinkingListEl || activeIndex <= this.thinkingStage) return;
    const prior = this.thinkingRows.get(this.thinkingStage);
    if (prior) {
      this.setThinkingRowStatus(prior, "complete");
      const time = prior.querySelector<HTMLElement>(".nox-thinking-phase-time");
      if (time) time.textContent = this.formatElapsed(Date.now() - this.thinkingStageAt);
    }

    const labels = [
      "Resolving context",
      "Preparing " + (ACTIONS.find(action => action.kind === this.runningAction)?.label ?? "Ask") + " request",
      "Waiting for AI activity",
      "Receiving model output",
      "Finalizing response",
    ];
    const label = labels[activeIndex];
    if (!label) return;
    // Add only actually observed stages. Do not backfill missing ones.
    const row = this.thinkingListEl.createDiv({ cls: "nox-thinking-row" });
    row.createSpan({ cls: "nox-thinking-marker" });
    row.createSpan({ cls: "nox-thinking-primary", text: label });
    row.createSpan({ cls: "nox-thinking-phase-time" });
    this.thinkingRows.set(activeIndex, row);
    this.thinkingStage = activeIndex;
    this.thinkingStageAt = Date.now();
    this.setThinkingRowStatus(row, "active");
    this.followThinkingActivity();
  }

  private appendThinkingTool(id: string, name: string): void {
    if (!this.thinkingListEl || this.thinkingToolRows.has(id) || this.thinkingToolRows.size >= 40) return;
    const row = this.thinkingListEl.createDiv({ cls: "nox-thinking-row nox-thinking-tool" });
    row.dataset.status = "running";
    const marker = row.createSpan({ cls: "nox-thinking-marker" });
    setNoxIcon(marker, "wrench");
    row.createSpan({ cls: "nox-thinking-primary", text: name });
    row.createSpan({ cls: "nox-thinking-phase-time", text: "Running" });
    this.thinkingToolRows.set(id, row);
    this.followThinkingActivity();
  }

  private completeThinkingTool(id: string, outcome: "completed" | "failed"): void {
    const row = this.thinkingToolRows.get(id);
    if (!row || row.dataset.status !== "running") return;
    row.dataset.status = outcome;
    const marker = row.querySelector<HTMLElement>(".nox-thinking-marker");
    if (marker) setNoxIcon(marker, outcome === "completed" ? "check" : "x");
    const meta = row.querySelector<HTMLElement>(".nox-thinking-phase-time");
    if (meta) meta.textContent = outcome === "completed" ? "Done" : "Failed";
  }

  private followThinkingActivity(): void {
    const viewport = this.thinkingViewportEl;
    if (!viewport || !this.statusEl?.hasClass("nox-thinking--working")) return;
    // Short capped activity viewport; newest *observed* event stays visible.
    window.requestAnimationFrame(() => {
      if (this.thinkingViewportEl === viewport && viewport.isConnected) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    });
  }

  private startLoadingTimer(): void {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }

    const update = () => {
      const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
      if (this.loadingElapsedEl) this.loadingElapsedEl.textContent = elapsed;
      if (this.thinkingLabelEl?.hasClass("nox-thinking-label--active")) {
        const quietMs = Date.now() - this.lastAgentActivityAt;
        this.thinkingLabelEl.textContent = this.thinkingStage === 2
          ? "Waiting for AI"
          : this.thinkingStage === 4 ? "Finalizing"
          : this.thinkingStage === 3 ? "Receiving response"
          : this.thinkingStage === 1 ? "Preparing request" : "Working";
        const waiting = this.thinkingRows.get(2)?.querySelector<HTMLElement>(".nox-thinking-phase-time");
        if (waiting && this.thinkingStage === 2 && quietMs >= 15_000) {
          waiting.textContent = "No updates yet";
        }
      }
    };

    this.loadingStartedAt = Date.now();
    update();
    this.loadingTimer = window.setInterval(update, 500);
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
      // Mode commands remain local capabilities when the runtime is unavailable.
      disabled: false,
      canSend: this.canSend(),
    });
  }

  private canSend(): boolean {
    const hasInput = this.input.value.trim().length > 0 || this.attachments.length > 0;
    return hasInput && (this.runtimeReady || this.learning.canExecuteOfflineCommand(this.input.value));
  }

  /** Enter the first actual learning activity via the existing focus and next commands. */
  private async beginFirstOnboardingObjective(programId: string, objectiveId: string): Promise<void> {
    if (this.uiState === "RUNNING" || this.pendingReplyTo || this.input.value.trim()) {
      throw new Error("Send or clear the composer before starting the objective.");
    }
    const menu = await this.learning.getProgramMenuState();
    const overview = await this.learning.getProgramOverview();
    if (menu.activeProgramId !== programId || !overview ||
        overview.focus || overview.next.objectiveId !== objectiveId) {
      throw new Error("The learning plan changed. Review your current objective in /progress.");
    }
    const makeCommand = (prompt: string): LearningRequest => ({
      turnId: crypto.randomUUID(), prompt, action: "ask", explicitContext: [],
    });
    const focus = { ...makeCommand("/focus " + objectiveId), focusProgramId: programId };
    this.setAction("ask");
    this.lastTurnRequest = focus;
    await this.runTurn(focus, true);
    // A failed /focus does not make an inference request. Confirm durable authority
    // before issuing /next, which can call a provider and produce learning evidence.
    const after = await this.learning.getProgramOverview();
    const current = await this.learning.getProgramMenuState();
    if (current.activeProgramId !== programId ||
        after?.focus?.status !== "active" || after.focus.objectiveId !== objectiveId) {
      throw new Error("Objective focus was not started. Check the last response before retrying.");
    }
    if (!(await this.ensureRuntimeReady())) {
      throw new Error("Focus started, but the AI provider is unavailable. Reconnect and use /next.");
    }
    const next = makeCommand("/next");
    this.lastTurnRequest = next;
    await this.runTurn(next, true);
  }

  private showEmpty(): void {
    this.practiceUi.reset();
    this.transcriptPresenter.cancel();
    this.streamText.reset();
    this.transcriptSelection?.hide();
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
    this.statusEl = null;
    this.capabilityCards.clear();

    const slate = this.thread.createDiv({
      cls: "nox-empty-slate",
    });
    // First-run welcome uses the same sidebar, header and composer.
    // A damaged program index must NOT be treated as an empty vault.
    void this.learning.getOnboardingContext().then(state => {
      const pendingApproval = Boolean(state.draft?.approval);
      if (!slate.isConnected || state.dismissed ||
          (state.hasProgram && !pendingApproval) ||
          (this.learning.getSession().messages.length > 0 && !pendingApproval)) return;
      new OnboardingFlow(slate, this.learning, {
        onSkip: () => {
          void this.learning.dismissOnboarding().then(() => {
            this.showEmpty();
            this.focusComposer();
          }).catch(error => this.appendInlineStatus(this.thread, "failed",
            error instanceof Error ? error.message : "Could not save onboarding choice."));
        },
        onQuickPlan: async command => {
          if (this.uiState === "RUNNING" || this.input.value.trim()) {
            throw new Error("Send or clear the current composer draft first.");
          }
          if (!(await this.ensureRuntimeReady())) throw new Error("Connect your AI provider, then retry.");
          await this.learning.dismissOnboarding();
          this.setAction("ask");
          this.input.value = command;
          this.onInput();
          await this.doSend();
        },
        onNoteAction: async (path, kind) => {
          if (this.uiState === "RUNNING" || this.input.value.trim()) {
            throw new Error("Send or clear the current composer draft first.");
          }
          if (!(await this.ensureRuntimeReady())) throw new Error("Connect your AI provider, then retry.");
          await this.learning.dismissOnboarding();
          const request: LearningRequest = {
            turnId: crypto.randomUUID(),
            prompt: kind === "practice" ? "/free-practice"
              : "Explain the main concepts from this note with a concrete example.",
            action: kind === "practice" ? "ask" : "explain",
            explicitContext: [{ kind: "vault-note", path }],
            contextMode: "explicit-only",
            ...(kind === "practice" ? { sourcePath: path } : {}),
          };
          this.setAction(request.action);
          this.lastTurnRequest = request;
          await this.runTurn(request, true);
        },
        onCreated: async () => {
          await this.learning.dismissOnboarding();
          if (this.learning.getSession().messages.length) await this.restoreSession();
          else this.showEmpty();
          this.focusComposer();
        },
        onStart: async (programId, objectiveId) => {
          try {
            await this.learning.dismissOnboarding();
            await this.beginFirstOnboardingObjective(programId, objectiveId);
          } catch (error) {
            if (!slate.isConnected) {
              new Notice(error instanceof Error ? error.message : "Could not start the first objective.");
            }
            throw error;
          }
        },
      }, state.draft);
    }).catch(error => {
      console.warn("[Nox] Onboarding detection failed", error);
    });

    this.renderEmptyContext(slate);

    const intro = slate.createDiv({
      cls: "nox-empty-intro",
    });
    intro.createDiv({
      cls: "nox-empty-title",
      text: "What would you like to learn?",
    });
    intro.createDiv({
      cls: "nox-empty-description",
      text:
        "Continue a learning plan, or explore your current note.",
    });

    this.renderEmptyPrimary(slate);

    const section = slate.createDiv({
      cls: "nox-capability-section",
    });
    const sectionHead = section.createDiv({
      cls: "nox-capability-header",
    });
    sectionHead.createSpan({
      cls: "nox-capability-label",
      text: "Note tools",
    });

    const commandHint = sectionHead.createEl("button", {
      cls: "nox-capability-command-hint",
      text: "Search all actions /",
      attr: {
        type: "button",
        "aria-label": "Search Nox actions",
        "aria-controls": "nox-prompt-menu",
        "aria-expanded": "false",
      },
    });
    this.promptUi?.setCommandHint(commandHint);
    commandHint.addEventListener("click", () => {
      this.closeModelMenu();
      this.promptUi?.openCommand();
      this.focusComposer();
    });

    const grid = section.createDiv({
      cls: "nox-capability-grid",
    });

    const legacyLocked = this.learning.isActiveLearningScope(this.learning.getSession().learningScope);
    for (const capability of NOX_CAPABILITIES.filter(item =>
      !legacyLocked || item.action === "practice")) {
      const card = grid.createEl("button", {
        cls: `nox-capability-card nox-capability-card--${capability.tone}`,
        attr: {
          type: "button",
          "aria-label": capability.title + ": " + capability.description,
          "aria-pressed": String(this.selectedAction === capability.action),
          title: capability.description,
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

  private renderEmptyPrimary(slate: HTMLElement): void {
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
      if (this.uiState === "RUNNING" || !this.runtimeReady) return;
      const draft = this.input.value.trim();
      if (draft && (action.command?.trim() !== "/plan" || draft.startsWith("/"))) {
        new Notice("Finish or clear your message before starting another learning action.");
        this.focusComposer();
        return;
      }
      this.setAction("ask");
      this.input.value = draft ? `/plan ${draft}` : action.command ?? "";
      this.onInput();
      this.focusComposer();
      // Session commands are complete; /plan remains editable until the goal is ready.
      if (!draft && action.command && action.command.trim() !== "/plan") {
        void this.doSend();
      }
    });
    void this.learning.getProgramMenuState().then(state => {
      if (!slate.isConnected || !slate.contains(button)) return;
      update(getPrimaryAction(this.toActionMenuContext(state)));
    }).catch(() => {
      // Keep the non-destructive Create plan action available if the index cannot load.
    });
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

  /** An interrupted approved setup remains discoverable even with old chat history. */
  private async showPendingOnboardingRecovery(): Promise<void> {
    const sessionId = this.learning.getSession().id;
    try {
      const state = await this.learning.getOnboardingContext();
      if (sessionId !== this.learning.getSession().id || state.dismissed ||
          !state.draft?.approval || !this.thread.isConnected ||
          this.uiState === "RUNNING" || this.thread.querySelector(".nox-empty-slate") ||
          this.thread.querySelector(".nox-onboarding-recovery-notice")) return;
      const notice = createNoxStatus(this.thread, {
        cls: "nox-onboarding-recovery-notice",
        kind: "warning",
        text: "An approved learning setup needs recovery before continuing.",
        action: { label: "Resume recovery", onClick: () => {
          if (this.uiState !== "RUNNING") this.showEmpty();
        } },
      });
      this.thread.prepend(notice);
    } catch (error) {
      console.warn("[Nox] Could not check onboarding recovery", error);
    }
  }

  private async restoreSession(): Promise<void> {
    const messages = this.learning.getSession().messages;
    await this.transcriptPresenter.restore(messages, {
      clear: () => this.thread.empty(),
      empty: () => this.showEmpty(),
      user: message => this.appendUserBubble(message.content, message.id, message.replyTo),
      thinking: message => { this.appendRestoredThinkingTrace(message); },
      assistant: (message, index) =>
        this.appendRestoredAssistant(message.content, message.sourcePath, index),
      proposal: message => this.appendRestoredProposal(message),
      structured: message => this.appendRestoredStructuredParts(message),
      complete: () => {
        this.setUIState(this.runtimeReady ? "ANSWER" : "ERROR");
        this.scrollThread("auto");
      },
    });
  }

  private async appendRestoredAssistant(
    markdown: string,
    messageSourcePath?: string,
    messageIndex?: number,
  ): Promise<void> {
    const bubble = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--agent",
    });
    createNoxMessageMeta(bubble, {
      label: "Nox",
      sub: "Restored",
    });
    const content = bubble.createDiv({
      cls: "nox-bubble-content nox-message-content nox-markdown",
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
    if (!bubble.isConnected) return;
    this.wireMarkdownLinks(content, sourcePath);
    enhanceNoxResponseVisuals(content);
    if (messageIndex !== undefined) this.appendResponseActions(bubble, markdown, messageIndex);
  }

  private appendRestoredStructuredParts(message: ChatMessage): void {
    for (const part of message.parts ?? []) {
      const bubble = this.thread.createDiv({ cls: "nox-bubble nox-bubble--agent" });
      createNoxMessageMeta(bubble, { label: "Nox", sub: "Restored" });
      if (part.type === "practice-question") {
        this.appendPracticeQuestion(part.question, bubble, part.questionId);
      } else if (part.type === "practice-evaluation") {
        this.appendPracticeEvaluation(part.evaluation, bubble, part.questionId);
      } else if (part.type === "review-findings") {
        this.appendReviewFindings(part.findings, part.sourcePath ?? message.sourcePath ?? null, bubble);
      }
    }
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

  private appendUserBubble(
    text: string, messageId?: string, replyTo?: ChatReplyReference,
  ): void {
    this.thread.querySelector(".nox-empty-slate")?.remove();
    const wrap = this.thread.createDiv({ cls: "nox-user-message" });
    if (replyTo) wrap.createDiv({
      cls: "nox-user-message-quote",
      text: "Reply to Nox · " + replyTo.quote.slice(0, 110),
    });
    const bubble = wrap.createDiv({ cls: "nox-bubble nox-bubble--user" });
    bubble.createDiv({ cls: "nox-message-content", text });
    appendMessageActions(wrap, {
      text, messageId, onFork: id => this.forkMessage(id),
    });
    animateNoxEnter(wrap, 4);
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
      cls: "nox-bubble-content nox-message-content",
    });
    animateNoxEnter(this.agentCursorEl, 4);
  }

  private buildThinkingTrace(): HTMLElement {
    const trace = this.thread.createDiv({ cls: "nox-thinking nox-thinking--working" });
    trace.setAttribute("role", "group");
    trace.setAttribute("aria-label", "Nox run activity");
    this.statusEl = trace;
    const toggle = trace.createEl("button", {
      cls: "nox-thinking-toggle",
      attr: { type: "button", "aria-expanded": "true" },
    });
    this.thinkingToggleEl = toggle;
    toggle.createEl("img", {
      cls: "nox-thinking-logo",
      attr: { src: this.getLogoUrl(), alt: "" },
    });
    this.thinkingLabelEl = toggle.createSpan({
      cls: "nox-thinking-label nox-thinking-label--active",
      text: "Working",
    });
    this.loadingElapsedEl = toggle.createSpan({ cls: "nox-thinking-elapsed" });
    this.loadingElapsedEl.setAttribute("aria-hidden", "true");
    const chevron = toggle.createSpan({ cls: "nox-thinking-chevron" });
    setNoxIcon(chevron, "chevron-down");
    this.thinkingChevronEl = chevron;

    // The 0fr/1fr grid must have exactly one direct child. The previous
    // list + inspector siblings caused the inspector to escape disclosure.
    const panel = trace.createDiv({ cls: "nox-thinking-panel is-expanded" });
    panel.id = "nox-activity-" + crypto.randomUUID();
    toggle.setAttribute("aria-controls", panel.id);
    this.thinkingLabelEl.setAttribute("aria-live", "polite");
    this.thinkingPanelEl = panel;
    const inner = panel.createDiv({ cls: "nox-thinking-panel-inner" });
    const viewport = inner.createDiv({ cls: "nox-thinking-viewport" });
    this.thinkingViewportEl = viewport;
    this.thinkingListEl = viewport.createDiv({ cls: "nox-thinking-trace nox-thinking-trace--facts" });
    this.runInspector = new NoxRunInspector(inner);

    this.setThinkingStage(0);
    toggle.addEventListener("click", () => {
      const expanded = !panel.hasClass("is-expanded");
      this.thinkingManualExpanded = expanded;
      this.updateThinkingDisclosure(expanded);
    });

    this.startLoadingTimer();
    animateNoxEnter(trace, 4);
    return trace;
  }

  private appendThoughtText(text: string): void {
    this.ensureThinkingTrace();
    this.setThinkingStage(3);
    if (!this.thinkingPanelEl) return;

    if (!this.thinkingThoughtEl) {
      this.thinkingThoughtEl = (this.thinkingPanelEl.querySelector<HTMLElement>(".nox-thinking-panel-inner") ?? this.thinkingPanelEl).createDiv({
        cls: "nox-thinking-thought",
      });
    }

    this.streamedThoughtText += text;
    this.thinkingThoughtEl.textContent = this.streamedThoughtText;

    // Model-supplied thought text is optional; never auto-reveal private trace text.
  }

  private appendRestoredThinkingTrace(message: ChatMessage): HTMLElement {
    const trace = this.thread.createDiv({ cls: "nox-thinking nox-thinking--restored" });
    trace.setAttribute("role", "status");

    const toggle = trace.createEl("button", {
      cls: "nox-thinking-toggle",
      attr: { type: "button", "aria-expanded": "false" },
    });

    toggle.createEl("img", {
      cls: "nox-thinking-logo",
      attr: { src: this.getLogoUrl(), alt: "" },
    });

    const elapsed = message.elapsedMs !== undefined ? this.formatElapsed(message.elapsedMs) : null;
    const labelText = message.thought
      ? (elapsed ? `Thought for ${elapsed}` : "Thought")
      : (elapsed ? `Completed in ${elapsed}` : "Completed");

    toggle.createSpan({
      cls: "nox-thinking-label nox-thinking-label--done",
      text: labelText,
    });

    const chevron = toggle.createSpan({ cls: "nox-thinking-chevron" });
    setNoxIcon(chevron, "chevron-down");

    const panel = trace.createDiv({ cls: "nox-thinking-panel" });
    panel.id = "nox-activity-" + crypto.randomUUID();
    toggle.setAttribute("aria-controls", panel.id);
    const inner = panel.createDiv({ cls: "nox-thinking-panel-inner" });
    const list = inner.createDiv({ cls: "nox-thinking-trace nox-thinking-trace--facts" });

    const source = message.sourcePath;
    const facts: Array<{ primary: string; secondary?: string }> = [
      {
        primary: "Resolving context",
        secondary: source?.split("/").pop(),
      },
      {
        primary: `Ran ${ACTIONS.find((action) => action.kind === message.action)?.label ?? "Ask"}`,
      },
      { primary: "Generated response" },
    ];

    for (const fact of facts) {
      const row = list.createDiv({ cls: "nox-thinking-row is-done" });
      const marker = row.createSpan({ cls: "nox-thinking-marker" });
      setNoxIcon(marker, "check");
      row.createSpan({ cls: "nox-thinking-primary", text: fact.primary });
      if (fact.secondary) row.createSpan({ cls: "nox-thinking-secondary", text: fact.secondary });
    }

    if (message.thought?.trim()) {
      const thoughtEl = inner.createDiv({ cls: "nox-thinking-thought" });
      thoughtEl.textContent = message.thought;
    }

    toggle.addEventListener("click", () => {
      const expanded = !panel.hasClass("is-expanded");
      panel.toggleClass("is-expanded", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      chevron.toggleClass("is-expanded", expanded);
    });

    return trace;
  }

  private appendToAgentBubble(text: string): void {
    this.ensureAgentBubble(true);
    if (this.agentContentEl) this.streamText.append(this.agentContentEl, text);
  }

  private flushStreamingText(): void {
    this.streamText.flush();
  }

  private renderMarkdownResponse(): void {
    if (!this.agentContentEl || !this.streamText.text.trim()) return;

    const content = this.agentContentEl;
    const markdown = this.streamText.text;
    const sourcePath =
      this.currentContext?.selection?.file ??
      this.currentContext?.activeNote?.path ??
      "Nox.md";

    content.empty();
    content.addClass("nox-markdown");

    void MarkdownRenderer.render(this.app, markdown, content, sourcePath, this)
      .then(() => {
        this.wireMarkdownLinks(content, sourcePath);
        enhanceNoxResponseVisuals(content);
      })
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
    if (!this.agentCursorEl || !this.streamText.text.trim()) return;
    const messages = this.learning.getSession().messages;
    if (messages.length) {
      this.appendResponseActions(this.agentCursorEl, this.streamText.text, messages.length - 1);
    }
  }

  /** Identical icon toolbar for completed live turns and restored history. */
  private appendResponseActions(
    bubble: HTMLElement, responseText: string, messageIndex: number,
  ): void {
    renderResponseActions(
      bubble, responseText, messageIndex, this.learning.getSession(),
      this.learning.hasActivePracticeQuestion(), {
        isBusy: () => this.uiState === "RUNNING",
        canRegenerate: () => this.uiState !== "RUNNING" && this.runtimeReady,
        onFork: id => this.forkMessage(id),
        onSelectVersion: (index, version, sessionId) => {
          if (this.learning.getSession().id !== sessionId) return;
          void this.learning.selectResponseVersion(index, version)
            .then(() => this.restoreSession())
            .catch(() => new Notice("Could not select response version."));
        },
        onRegenerate: (index, user, assistant) => {
          const request: LearningRequest = {
            turnId: crypto.randomUUID(),
            prompt: user.content,
            action: user.action === "explain" ? "explain" : "ask",
            explicitContext: [],
            regenerate: { messageIndex: index, expectedContent: assistant.content },
            ...(user.replyTo ? { replyTo: user.replyTo } : {}),
          };
          this.lastTurnRequest = request;
          void this.runTurn(request, false);
        },
        onQuickCheck: text => {
          this.setAction("practice");
          this.input.value = "Generate one interactive knowledge-check question " +
            "(MCQ, essay, or code if appropriate) about this explanation: " +
            JSON.stringify(text.slice(0, 1600));
          this.onInput();
          void this.doSend();
        },
      },
    );
  }

  private appendPracticeQuestion(
    question: PracticeQuestion,
    parent: HTMLElement | null = this.agentCursorEl,
    questionId?: string,
  ): void {
    if (!parent) return;
    this.practiceUi.renderQuestion(parent, question, questionId);
    this.scrollThread();
  }

  private appendPracticeEvaluation(
    evaluation: PracticeEvaluation,
    parent: HTMLElement | null = this.agentCursorEl,
    questionId?: string,
  ): void {
    if (!parent) return;
    this.practiceUi.renderEvaluation(parent, evaluation, questionId);
    this.scrollThread();
  }

  private async requestPracticeHint(question: PracticeQuestion, sessionId: string): Promise<boolean> {
    if (this.uiState === "RUNNING" || !this.learning.hasActivePracticeQuestion() ||
        this.learning.getSession().id !== sessionId) return false;
    const before = this.learning.getSession().messages.length;
    const request: LearningRequest = {
      prompt: "/hint", action: "practice", explicitContext: [],
      turnId: crypto.randomUUID(),
    };
    this.lastTurnRequest = request;
    await this.runTurn(request, true);
    // Only a durable transcript hint can unlock the disclosure.
    const after = this.learning.getSession();
    return after.id === sessionId && after.messages.slice(before).some(
      message => message.role === "assistant" && message.content === "Hint: " + question.hint);
  }

  private async submitPracticeAnswer(
    questionId: string, answer: PracticeAnswer, sessionId: string,
  ): Promise<boolean> {
    if (this.uiState === "RUNNING" || this.learning.getSession().id !== sessionId) return false;
    // Persist before inference so cancellation and retry cannot discard the answer.
    await this.learning.savePracticeDraft(questionId, answer);
    const summary = answer.type === "multiple-choice"
      ? "Selected option: " + answer.optionId
      : answer.type === "code"
        ? "Code answer (" + answer.language + "):\n" + answer.source
        : answer.text;
    const request: LearningRequest = {
      turnId: crypto.randomUUID(), action: "practice",
      prompt: summary, explicitContext: [],
      practiceSubmission: { questionId, answer },
    };
    this.lastTurnRequest = request;
    await this.runTurn(request, true);
    return this.learning.getSession().id === sessionId &&
      this.learning.getSession().messages.some(message => message.parts?.some(part =>
        part.type === "practice-evaluation" && part.questionId === questionId));
  }

  private prepareNextPracticeActivity(evaluation: PracticeEvaluation, sessionId: string): void {
    if (this.uiState === "RUNNING" || this.learning.getSession().id !== sessionId) return;
    void this.learning.getProgramMenuState().then(state => {
      if (this.learning.getSession().id !== sessionId) return;
      this.setAction(state.activeProgramId ? "ask" : "practice");
      this.input.value = state.activeProgramId
        ? (state.focusStatus === "paused" ? "/resume-focus" :
            state.sessionActive ? "/next" : "/progress")
        : "Give me another practice question about " + evaluation.concept + ".";
      this.onInput();
      this.focusComposer();
    }).catch(() => new Notice("Unable to prepare the next learning activity."));
  }

  private appendReviewFindings(
    findings: ReviewFinding[],
    sourcePath: string | null,
    parent: HTMLElement | null = this.agentCursorEl,
  ): void {
    if (!parent) return;
    renderReviewFindingCards(parent, findings, {
      onPractice: (finding) => {
        this.setAction("practice");
        this.pinFindingSource(sourcePath);
        this.input.value = `Practice this gap: ${finding.concept} — ${finding.detail}`;
        this.onInput();
        this.input.focus();
      },
      onFix: (finding) => {
        this.setAction("edit");
        this.pinFindingSource(sourcePath);
        this.input.value = `Fix this learning gap: ${finding.detail}`;
        this.onInput();
        this.input.focus();
        if (sourcePath && this.currentContext?.activeNote?.path !== sourcePath) {
          void this.app.workspace.openLinkText(sourcePath, sourcePath, false)
            .then(() => this.syncChips())
            .catch(() => {
              this.appendInlineStatus(this.thread, "failed", `Open ${sourcePath} to edit this finding.`);
            });
        }
      },
    });
    this.scrollThread();
  }

  private pinFindingSource(sourcePath: string | null): void {
    this.pendingFindingSource = sourcePath;
    // LearningController resolves this note as a fresh explicit source on send.
    // Show one pinned primary chip instead of duplicating it as an attachment.
    this.syncContextChips();
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

    rejectBtn.addEventListener("click", () => { void (async () => {
      rejectBtn.disabled = true;
      applyBtn.disabled = true;
      try {
        await this.learning.rejectProposal(edit.id);
        actions.remove();
        createNoxStatus(wrap, {
          cls: "nox-result-badge nox-badge--rejected",
          kind: "neutral",
          text: "✕ Rejected",
        });
        this.setUIState("ANSWER");
      } catch {
        rejectBtn.disabled = false;
        applyBtn.disabled = false;
        this.appendInlineStatus(wrap, "failed", "Could not save rejection. Retry.");
      }
    })().catch(error => console.warn("[Nox] UI action failed", error)); });

    applyBtn.addEventListener("click", () => { void (async () => {
      applyBtn.disabled = true;
      rejectBtn.disabled = true;
      applyBtn.textContent = "Applying…";

      try {
        const result = await this.learning.applyProposal(edit.id);
        wrap.querySelector(".nox-proposal-retry-status")?.remove();
        if (result.ok) {
          actions.remove();
          if (result.statusSync === "failed") {
            this.appendAppliedStatusRecovery(wrap, edit.id, proposal.file, result.message);
            this.setUIState("ANSWER");
          } else {
            createNoxStatus(wrap, {
              cls: "nox-result-badge nox-badge--applied",
              kind: "success",
              text: "✓ Applied to " + proposal.file,
            });
            this.setUIState("APPLIED");
          }
        } else if (result.reason === "status-unsaved") {
          actions.remove();
          this.appendAppliedStatusRecovery(wrap, edit.id, proposal.file, result.message);
        } else if (result.reason === "no-editor" || result.reason === "error") {
          // Source remains valid: keep Apply available after the user fixes the blocker.
          applyBtn.disabled = false;
          rejectBtn.disabled = false;
          applyBtn.textContent = "Retry Apply";
          createNoxStatus(wrap, {
            cls: "nox-proposal-retry-status",
            kind: "warning",
            text: result.message,
          });
        } else {
          actions.remove();
          createNoxStatus(wrap, {
            cls: "nox-result-badge nox-badge--stale",
            kind: "warning",
            text: result.message,
          });
          this.setUIState("ANSWER");
        }
      } catch {
        applyBtn.disabled = false;
        rejectBtn.disabled = false;
        applyBtn.textContent = "Retry Apply";
        this.appendInlineStatus(wrap, "failed", "Could not save the result. Check the note before retrying.");
      }
    })().catch(error => console.warn("[Nox] UI action failed", error)); });
  }

  private appendAppliedStatusRecovery(
    wrap: HTMLElement,
    proposalId: string,
    file: string,
    message?: string,
  ): void {
    const recovery = wrap.createDiv({ cls: "nox-proposal-status-recovery" });
    let status = createNoxStatus(recovery, {
      cls: "nox-proposal-retry-status",
      kind: "warning",
      text: message ?? "Edit applied, but status could not be saved.",
    });
    const retryBtn = createNoxButton(recovery, {
      cls: "nox-btn-sync-status",
      variant: "secondary",
      text: "Retry status sync",
    });
    retryBtn.addEventListener("click", () => { void (async () => {
      retryBtn.disabled = true;
      retryBtn.textContent = "Saving status…";
      try {
        const result = await this.learning.retryAppliedStatus(proposalId);
        if (result.ok && result.statusSync !== "failed") {
          recovery.remove();
          createNoxStatus(wrap, {
            cls: "nox-result-badge nox-badge--applied",
            kind: "success",
            text: "✓ Applied to " + file,
          });
          this.setUIState("APPLIED");
          return;
        }
        status.remove();
        status = createNoxStatus(recovery, {
          cls: "nox-proposal-retry-status",
          kind: "warning",
          text: result.message ?? "Status was not saved. Do not apply the edit again.",
        });
      } catch {
        status.remove();
        status = createNoxStatus(recovery, {
          cls: "nox-proposal-retry-status",
          kind: "warning",
          text: "Status sync failed. The note was already edited; do not apply again.",
        });
      }
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry status sync";
    })().catch(error => console.warn("[Nox] UI action failed", error)); });
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
    if (this.transcriptPresenter.isRestoring) return;
    this.thread.scrollTo({
      top: this.thread.scrollHeight,
      behavior,
    });
  }
}
