import { renderLearningActivity } from "./activity-heatmap";
import { OnboardingFlow } from "./onboarding-flow";
import { LatestAsyncResult } from "./latest-async-result";
import {
  ItemView,
  Notice,
  Modal,
  MarkdownRenderer,
  WorkspaceLeaf,
  type IconName,
} from "obsidian";
import {
  LearningController,
  type LearningActionKind,
  type LearningEvent,
  type LearningRequest,
  type ExplicitContextRef,
  type LearningContext,
  type PracticeAnswer,
  type PracticeEvaluation,
  type PracticeQuestion,
  type ReviewFinding,
  type ChatMessage,
  type ChatReplyReference,
} from "@nox/core";
import { PracticePresenter } from "../features/practice/view/PracticePresenter";
import { renderReviewFindingCards } from "./learning-card-renderers";
import { parsePromptToken, stripPromptToken } from "./prompt-token";
import { NOX_CAPABILITIES } from "./capabilities";
import { buildActionMenu, getPrimaryAction, type ActionMenuContext } from "./action-menu";
import { animateNoxEnter } from "./motion";
import { resolveNoxMarkdownLink } from "./markdown-links";
import {
  shouldResetAction,
  TerminalOutcome,
} from "./chat-state";
import {
  createNoxIconButton,
  createNoxMessageMeta,
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
import { NoxComposer } from "./composer";
import { projectComposerPlaceholder, projectComposerContextChips } from "./composer-view-projection";
import { ComposerAttachmentDraft } from "./composer-draft";
import { ThinkingPresenter } from "./thinking-presenter";
import { ProposalPresenter } from "./proposal-presenter";
import { renderEmptyPrimary, renderEmptyContext } from "./empty-slate-renderer";
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
  private readonly attachmentDraft = new ComposerAttachmentDraft();

  private agentCursorEl: HTMLElement | null = null;
  private agentContentEl: HTMLElement | null = null;
  private thinkingUi: ThinkingPresenter | null = null;
  private proposalUi: ProposalPresenter | null = null;
  private sessionClockEl: HTMLElement | null = null;
  private sessionClockTextEl: HTMLElement | null = null;
  private sessionClockButtonEl: HTMLButtonElement | null = null;
  private readonly streamText = new StreamTextPresenter({
    request: callback => window.requestAnimationFrame(callback),
    cancel: id => window.cancelAnimationFrame(id),
  });
  private focusStripEl: HTMLButtonElement | null = null;

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
  private readonly runtimeHealth = new LatestAsyncResult();
  private restoringSession = false;
  private workspaceEventsRegistered = false;
  private runtimeReady = false;
  private runtimeFailureMessage: string | null = null;
  private contextSyncRequest = 0;
  private turnContextSource: string | null = null;
  private pendingFindingSource: string | null = null;

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
    const openingEpoch = ++this.viewEpoch;
    this.runtimeHealth.invalidate();
    const root = this.contentEl;
    root.empty();
    root.addClass("nox-root");

    this.buildHeader(root);
    this.thread = root.createDiv({ cls: "nox-thread" });
    this.proposalUi = new ProposalPresenter(this.thread, {
      reject: id => this.learning.rejectProposal(id),
      apply: id => this.learning.applyProposal(id),
      retryStatus: id => this.learning.retryAppliedStatus(id),
      setState: state => this.setUIState(state),
      reportError: (parent, message) => this.appendInlineStatus(parent, "failed", message),
      scroll: () => this.scrollThread(),
    });
    this.thinkingUi?.dispose();
    this.thinkingUi = new ThinkingPresenter(
      this.thread,
      this.getLogoUrl,
      action => ACTIONS.find(item => item.kind === action)?.label ?? "Ask",
    );
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
    if (openingEpoch !== this.viewEpoch) return;
    await this.ensureRuntimeReady();
    if (openingEpoch !== this.viewEpoch) return;
    void this.refreshFocusStrip();
    this.learningUi.startClock(this.sessionClockEl!, this.sessionClockTextEl!, this.sessionClockButtonEl!);
    void this.refreshSessionClock();
  }

  async onClose(): Promise<void> {
    ++this.viewEpoch;
    this.runtimeHealth.invalidate();
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
    this.thinkingUi?.dispose();
    this.thinkingUi = null;
    this.proposalUi = null;
    this.practiceUi.dispose();
    this.modelUi?.dispose();
    this.modelUi = null;
    this.promptUi?.dispose();
    this.promptUi = null;
  }

  async refreshRuntime(recheckHealth = true): Promise<void> {
    const epoch = this.viewEpoch;
    if (recheckHealth) {
      // Invalidate before any awaits so a previous provider cannot revive UI state.
      this.runtimeHealth.invalidate();
      this.runtimeReady = false;
      this.setUIState(this.uiState);
    }
    await this.refreshModelList();
    // Closing during model refresh must not start a new check on detached DOM.
    if (epoch !== this.viewEpoch) return;
    if (recheckHealth) await this.ensureRuntimeReady(true);
  }

  private async ensureRuntimeReady(preserveState = false): Promise<boolean> {
    const outcome = await this.runtimeHealth.run(() => this.learning.checkRuntime());
    // A newer check, provider refresh, or closed view owns the visible state.
    if (outcome.status === "stale") return false;
    if (outcome.status === "failed") {
      this.showRuntimeError("Agent runtime is unavailable. Check Nox runtime settings.");
      return false;
    }
    const health = outcome.value;
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
    this.thinkingUi?.reset();
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
    
    this.attachmentDraft.clear();
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
      this.attachmentDraft.items().map((attachment) => ({
        key: attachment.name,
        text: attachment.name,
        onRemove: () => {
          if (!this.attachmentDraft.remove(attachment)) return;
          
          this.renderAttachments();
          void this.syncChips();
        },
      })),
    );
  }

  private async handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    this.closePromptMenu();
    const epoch = this.viewEpoch;
    const sessionId = this.learning.getSession().id;
    const input = this.fileInput;
    const pending: Array<{ name: string; content: string }> = [];

    try {
      for (const file of Array.from(files)) {
        const content = await file.text();
        if (epoch !== this.viewEpoch || this.learning.getSession().id !== sessionId) return;
        pending.push({ name: file.name, content });
      }
    } catch (error) {
      if (epoch === this.viewEpoch) {
        new Notice(error instanceof Error ? error.message : "Could not read attached file.");
      }
      return;
    } finally {
      // Clear the original picker; never touch the newly mounted Composer on close.
      input.value = "";
    }

    for (const file of pending) {
      this.attachmentDraft.add(file.name, {
        kind: "attachment",
        name: file.name,
        content: file.content,
      });
    }
    this.renderAttachments();
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
        const sessionId = this.learning.getSession().id;
        programState = this.commandProgramSnapshot ??
          await this.learning.getProgramMenuState();
        // A closed menu or switched session cannot reinstate a stale program cache.
        if (this.promptUi?.isOpen && this.learning.getSession().id === sessionId) {
          this.commandProgramSnapshot = programState;
        }
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
        ...this.attachmentDraft.contexts()
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
      const exists = this.attachmentDraft.hasNote(action.path);

      if (!exists) {
        const ref: ExplicitContextRef = {
          kind: "vault-note",
          path: action.path,
        };

        this.attachmentDraft.add(action.path.split("/").pop() ?? action.path, ref);
        
        this.renderAttachments();
        await this.syncChips();
      }

      this.input.value = prefix;
      this.closePromptMenu();
      this.onInput();
      this.input.focus();
      return;
    }

    // Page navigation is presenter-owned, never dispatched to the application.
    if (action.type === "programs" || action.type === "menu-back") return;
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
    if (this.input) {
      this.input.placeholder = projectComposerPlaceholder(
        this.selectedAction,
        this.currentContext,
        this.learning.isActiveLearningScope(this.learning.getSession().learningScope),
      );
    }
  }

  private async syncChips(): Promise<void> {
    const requestId = ++this.contextSyncRequest;
    let context: LearningContext;
    try {
      context = await this.learning.resolveContext(this.attachmentDraft.contexts());
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
    this.composerUi.setContexts(projectComposerContextChips(
      this.currentContext,
      this.pendingFindingSource,
      this.selectedAction,
      this.systemContextFiles,
    ));
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
      explicitContext: [...this.attachmentDraft.contexts()],
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
    this.attachmentDraft.clear();
    
    this.renderAttachments();
    this.sendBtn.disabled = true;

    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.streamText.reset();
    this.thinkingUi?.reset();
    this.turnTerminal = false;

    this.runningAction = request.action;
    this.turnContextSource = null;
    if (appendUserMessage) this.appendUserBubble(request.prompt, request.turnId, request.replyTo);
    this.setUIState("RUNNING");
    this.thinkingUi?.begin(request.action);

    try {
      let regenerated = false;
      const sessionId = this.learning.getSession().id;
      for await (const event of this.learning.run({
        ...request,
        retry: !appendUserMessage && !request.regenerate,
      })) {
        // The Obsidian leaf may have closed while a provider was awaiting I/O.
        // Do not write streamed content into detached or subsequently remounted UI.
        if (epoch !== this.viewEpoch) {
          this.learning.cancel();
          return;
        }
        if (event.type === "completed") regenerated = true;
        this.handleLearningEvent(event);
      }
      // Drop the provisional streaming bubble only after the new version is
      // durable. A failure leaves the original response intact.
      if (epoch === this.viewEpoch && request.regenerate && regenerated &&
          this.learning.getSession().id === sessionId) {
        await this.restoreSession();
      }
    } catch (error) {
      if (epoch !== this.viewEpoch) return;
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
      if (event.phase === "waiting-model") this.thinkingUi?.stage(2);
      else if (event.phase === "receiving-output") this.thinkingUi?.stage(3);
      else this.thinkingUi?.stage(4);
      return;
    }
    if (event.type === "tool-started") {
      this.thinkingUi?.toolStarted(event.toolCallId, event.name);
      return;
    }
    if (event.type === "tool-completed") {
      this.thinkingUi?.toolCompleted(event.toolCallId, event.outcome);
      return;
    }
    if (event.type === "context-ready") {
      this.thinkingUi?.contextReady(event.context);
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
      return;
    }

    if (event.type === "thought-delta") {
      const shouldFollow = this.isNearThreadBottom();
      this.thinkingUi?.thoughtDelta(event.text);
      if (shouldFollow) this.scrollThread("auto");
      return;
    }

    if (event.type === "response-delta") {
      const shouldFollow = this.isNearThreadBottom();
      this.thinkingUi?.activity();
      this.thinkingUi?.stage(3);
      this.appendToAgentBubble(event.text);
      if (shouldFollow) this.scrollThread("auto");
      return;
    }

    if (event.type === "practice-question") {
      this.setAction("practice");
      this.thinkingUi?.stage(3);
      this.ensureAgentBubble();
      this.appendPracticeQuestion(event.question, this.agentCursorEl, event.questionId);
      return;
    }

    if (event.type === "practice-evaluation") {
      this.thinkingUi?.stage(3);
      this.ensureAgentBubble();
      this.appendPracticeEvaluation(event.evaluation, this.agentCursorEl, event.questionId);
      return;
    }

    if (event.type === "review-findings") {
      this.thinkingUi?.stage(3);
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
      this.proposalUi?.append(event.edit);
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
    this.thinkingUi?.settleInspector(outcome);

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
    this.flushStreamingText();
    this.renderMarkdownResponse();
    if (doneLabel === undefined) this.appendStreamActions();
    this.thinkingUi?.finish(doneLabel);
    this.agentCursorEl?.removeClass("nox-bubble--streaming");
    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.streamText.detach();
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
    const hasInput = this.input.value.trim().length > 0 || this.attachmentDraft.length > 0;
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
    this.thinkingUi?.reset();
    this.thread.empty();
    this.agentCursorEl = null;
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

    renderEmptyContext(slate, this.currentContext);

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

    renderEmptyPrimary(slate, {
      getPrimaryAction: async () => getPrimaryAction(this.toActionMenuContext(
        await this.learning.getProgramMenuState())),
      canStart: () => this.uiState !== "RUNNING" && this.runtimeReady,
      getDraft: () => this.input.value.trim(),
      onBlocked: () => {
        new Notice("Finish or clear your message before starting another learning action.");
        this.focusComposer();
      },
      onStart: (action, draft) => {
        this.setAction("ask");
        this.input.value = draft ? "/plan " + draft : action.command ?? "";
        this.onInput();
        this.focusComposer();
        if (!draft && action.command && action.command.trim() !== "/plan") void this.doSend();
      },
    });

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
      thinking: message => { this.thinkingUi?.appendRestoredThinkingTrace(message); },
      assistant: (message, index) =>
        this.appendRestoredAssistant(message.content, message.sourcePath, index),
      proposal: message => { this.proposalUi?.restore(message); },
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

  private ensureAgentBubble(streaming = false): void {
    this.thinkingUi?.ensureTrace();
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
