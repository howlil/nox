import type { LearningActionKind } from "../application/learning-types";
import type { TurnContextSnapshot } from "../context/context-types";
import type { ChatMessage } from "../types";
import { setNoxIcon } from "./primitives";
import { animateNoxEnter } from "./motion";
import { NoxRunInspector } from "./run-inspector";
import type { TerminalOutcome } from "./chat-state";

/**
 * Owns the live and restored thinking UI, lifecycle, observed tool activity,
 * disclosure and elapsed timing. It never owns the canonical transcript or runtime.
 * No inferred tool/phase events or auto-disclosure of model thought text.
 */
export class ThinkingPresenter {
  private statusEl: HTMLElement | null = null;
  private loadingElapsedEl: HTMLElement | null = null;
  private loadingStartedAt = 0;
  private loadingTimer: number | null = null;
  private lastAgentActivityAt = 0;
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
  private runInspector: NoxRunInspector | null = null;
  private thinkingManualExpanded: boolean | null = null;
  private streamedThoughtText = "";
  private action: LearningActionKind = "ask";

  constructor(
    private readonly thread: HTMLElement,
    private readonly getLogoUrl: () => string,
    private readonly labelForAction: (action?: LearningActionKind) => string,
  ) {}

  /** Invalidate the active trace and cancel its private timer; persisted DOM is unchanged. */
  reset(): void {
    this.stopLoadingTimer();
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
    this.thinkingStageAt = 0;
    this.thinkingManualExpanded = null;
    this.streamedThoughtText = "";
    this.runInspector = null;
    this.lastAgentActivityAt = 0;
  }

  dispose(): void { this.reset(); }

  begin(action: LearningActionKind): void {
    this.reset();
    this.action = action;
    this.lastAgentActivityAt = Date.now();
    this.ensureTrace();
  }

  ensureTrace(): void {
    if (this.statusEl) return;
    this.statusEl = this.buildThinkingTrace();
  }

  activity(): void { this.lastAgentActivityAt = Date.now(); }

  stage(index: number): void { this.setThinkingStage(index); }

  toolStarted(id: string, name: string): void {
    this.activity();
    this.runInspector?.toolStarted(id, name);
    this.appendThinkingTool(id, name);
  }

  toolCompleted(id: string, outcome: "completed" | "failed"): void {
    this.activity();
    this.runInspector?.toolCompleted(id, outcome);
    this.completeThinkingTool(id, outcome);
  }

  contextReady(context: TurnContextSnapshot): void {
    this.runInspector?.setContext(context);
    this.stage(1);
  }

  thoughtDelta(text: string): void {
    this.activity();
    this.appendThoughtText(text);
  }

  settleInspector(outcome: TerminalOutcome): void {
    this.runInspector?.settle(outcome);
  }

  /** Keep the completed trace DOM for the transcript; only release live state. */
  finish(doneLabel?: string): void {
    const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
    this.settleThinking(doneLabel ?? "Completed in " + elapsed);
    this.reset();
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
      "Preparing " + (this.labelForAction(this.action)) + " request",
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
    this.ensureTrace();
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

  appendRestoredThinkingTrace(message: ChatMessage): HTMLElement {
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
        primary: `Ran ${this.labelForAction(message.action)}`,
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



}
