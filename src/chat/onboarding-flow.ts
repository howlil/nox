import type { LearningProgram } from "../domain/learning-program/types";
import type { LearningController } from "../application/LearningController";
import type { OnboardingDraft } from "../domain/onboarding/types";
import { restoreOnboardingDraft, withOnboardingStage, withOnboardingSource, onboardingConstraints, quickPlanCommand, firstOnboardingObjective } from "../features/learning/onboarding/OnboardingWorkflow";
import { planWorkspace } from "../domain/workspace/plan";
import { feasibility } from "../domain/learning-program/rules";
import { createNoxButton, setNoxIcon } from "./primitives";
import { animateNoxEnter } from "./motion";

interface Callbacks {
  onSkip(): void;
  onCreated(): Promise<void>;
  onStart(programId: string, objectiveId: string): Promise<void>;
  onQuickPlan(command: string): Promise<void>;
  onNoteAction(path: string, kind: "explain" | "practice"): Promise<void>;
}

/** Native NOX rendering. UI only: business mutations are owned by LearningController. */
export class OnboardingFlow {
  private stage: OnboardingDraft["stage"] = "welcome";
  private draft: OnboardingDraft = restoreOnboardingDraft();
  private preview: LearningProgram | null = null;
  private readyProgram: LearningProgram | null = null;
  private readyObjective: ReturnType<typeof firstOnboardingObjective> = null;
  private retryWorkspace: boolean | null = null;
  private launching = false;
  private error = "";
  private applying = false;
  private operationId?: string;
  private requestEpoch = 0;
  private cancelTo: OnboardingDraft["stage"] = "form";

  constructor(private readonly parent: HTMLElement, private readonly learning: LearningController,
    private readonly callbacks: Callbacks, initial?: OnboardingDraft) {
    this.draft = restoreOnboardingDraft(initial);
    this.stage = this.draft.stage;
    this.render();
    if (this.stage === "recovering") void this.recoverApproval();
  }

  private persist(): void {
    this.draft = withOnboardingStage(this.draft, this.stage);
    void this.learning.saveOnboardingDraft(this.draft).catch(error => {
      console.warn("[Nox] Could not save onboarding draft", error);
    });
  }
  private go(stage: OnboardingDraft["stage"]): void {
    this.requestEpoch++;
    this.stage = stage;
    this.error = "";
    this.persist();
    this.render();
    const focus = this.parent.querySelector<HTMLElement>(
      stage === "quick-goal" || stage === "form" ? ".nox-onboarding-field" : ".nox-empty-title");
    focus?.focus();
  }
  private icon(parent: HTMLElement, name: import("obsidian").IconName): HTMLElement {
    const el = parent.createSpan({ cls: "nox-onboarding-icon" });
    setNoxIcon(el, name);
    return el;
  }
  private button(parent: HTMLElement, text: string, action: () => void, primary = false): HTMLButtonElement {
    const button = createNoxButton(parent, { text, variant: primary ? "primary" : "secondary" });
    button.addEventListener("click", action);
    return button;
  }
  private actions(panel: HTMLElement, next: string, forward: () => void, back = "welcome"): void {
    const row = panel.createDiv({ cls: "nox-onboarding-actions" });
    this.button(row, "Back", () => this.go(back as OnboardingDraft["stage"]));
    this.button(row, next, forward, true);
  }
  private header(panel: HTMLElement, title: string, description: string): void {
    const label = panel.createSpan({ cls: "nox-onboarding-eyebrow", text: "GETTING STARTED" });
    label.setAttribute("aria-label", "Nox learning onboarding");
    panel.createEl("h2", { cls: "nox-empty-title", text: title, attr: { tabindex: "-1" } });
    panel.createDiv({ cls: "nox-empty-description", text: description });
  }
  private choices(panel: HTMLElement, items: Array<{ icon: import("obsidian").IconName;
    title: string; detail: string; click: () => void }>): void {
    const grid = panel.createDiv({ cls: "nox-onboarding-grid" });
    for (const item of items) {
      const card = grid.createEl("button", { cls: "nox-onboarding-card", attr: { type: "button" } });
      this.icon(card, item.icon);
      card.createSpan({ cls: "nox-onboarding-name", text: item.title });
      card.createSpan({ cls: "nox-onboarding-detail", text: item.detail });
      card.addEventListener("click", item.click);
    }
  }
  private field(panel: HTMLElement, title: string, value: string,
    update: (value: string) => void): HTMLTextAreaElement {
    panel.createEl("label", { cls: "nox-onboarding-label", text: title, attr: { for: "nox-learning-goal" } });
    const input = panel.createEl("textarea", {
      cls: "nox-onboarding-field", attr: { id: "nox-learning-goal", rows: "3", placeholder: "e.g. Build reliable REST APIs" },
    });
    input.value = value;
    input.addEventListener("input", () => update(input.value));
    input.addEventListener("change", () => this.persist());
    return input;
  }
  /** Identify the note without reading its content. The turn resolves the explicit ref. */
  private async selectCurrentNote(): Promise<void> {
    this.draft = withOnboardingSource(this.draft);
    this.go("notes");
    const epoch = this.requestEpoch;
    try {
      const ctx = await this.learning.getOnboardingContext();
      if (epoch !== this.requestEpoch) return;
      if (!ctx.activeNote) throw new Error("Open a Markdown note in Obsidian, then retry.");
      this.draft = withOnboardingSource(this.draft, ctx.activeNote);
      this.persist();
      this.render();
      this.parent.querySelector<HTMLElement>(".nox-empty-title")?.focus();
    } catch (error) {
      if (epoch !== this.requestEpoch) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.render();
    }
  }

  private async startQuickPlan(): Promise<void> {
    if (this.launching) return;
    let command: string;
    try { command = quickPlanCommand(this.draft.goal); }
    catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.render(); return;
    }
    const epoch = ++this.requestEpoch;
    this.error = "";
    this.launching = true; this.persist(); this.render();
    try {
      await this.requireProviderReady();
      if (epoch !== this.requestEpoch) return;
      await this.callbacks.onQuickPlan(command);
    } catch (error) {
      if (epoch !== this.requestEpoch) return;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.launching = false;
      if (epoch === this.requestEpoch && this.parent.isConnected) this.render();
    }
  }

  private async startNoteAction(kind: "explain" | "practice"): Promise<void> {
    if (this.launching) return;
    const source = this.draft.sourcePath;
    if (!source) {
      this.error = "Open a Markdown note in Obsidian, then select it.";
      this.render(); return;
    }
    const epoch = ++this.requestEpoch;
    this.error = "";
    this.launching = true; this.render();
    try {
      const current = await this.learning.getOnboardingContext();
      if (epoch !== this.requestEpoch) return;
      if (current.activeNote !== source) {
        throw new Error("The active note changed. Select the current note again.");
      }
      await this.requireProviderReady();
      if (epoch !== this.requestEpoch) return;
      await this.callbacks.onNoteAction(source, kind);
    } catch (error) {
      if (epoch !== this.requestEpoch) return;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.launching = false;
      if (epoch === this.requestEpoch && this.parent.isConnected) this.render();
    }
  }

  /** An early UI check only. Provider send still owns operational availability. */
  private async requireProviderReady(): Promise<void> {
    let health: Awaited<ReturnType<LearningController["checkRuntime"]>>;
    try {
      health = await this.learning.checkRuntime();
    } catch {
      throw new Error("AI provider is unavailable. Check Nox provider settings, then retry.");
    }
    if (health.status !== "ready") {
      throw new Error("AI provider is not ready: " + health.failure.message +
        " Check Nox provider settings, then retry.");
    }
  }

  private async prepare(): Promise<void> {
    const epoch = ++this.requestEpoch;
    this.cancelTo = "form";
    if (this.draft.goal.trim().length < 5) {
      this.error = "Enter a specific goal of at least five characters.";
      this.render(); return;
    }
    this.stage = "generating";
    this.render();
    try {
      const constraints = onboardingConstraints(this.draft);
      await this.requireProviderReady();
      if (epoch !== this.requestEpoch) return;
      const prepared = await this.learning.previewLearningProgram(this.draft.goal.trim(), constraints);
      if (epoch !== this.requestEpoch) return;
      this.preview = prepared;
      this.operationId = crypto.randomUUID();
      this.go("preview");
    } catch (error) {
      if (epoch !== this.requestEpoch) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.stage = "form";
      this.render();
    }
  }
  private async approve(withWorkspace: boolean): Promise<void> {
    if (!this.preview || !this.operationId || this.applying) return;
    // A workspace commit can succeed before the file writer fails. Do not let a
    // subsequent retry silently switch to plan-only with the same operation ID.
    if (this.retryWorkspace !== null && this.retryWorkspace !== withWorkspace) return;
    this.retryWorkspace = withWorkspace;
    const approval = { programId: this.preview.id, operationId: this.operationId, withWorkspace };
    this.applying = true;
    try {
      // The receipt must reach persistent storage before the first CAS/program write.
      await this.learning.saveOnboardingDraft({ ...this.draft, stage: "applying", approval });
    } catch (error) {
      this.error = "Could not save the approval receipt. No program was created. " +
        (error instanceof Error ? error.message : String(error));
      this.applying = false;
      this.stage = "preview";
      this.render();
      return;
    }
    this.draft = { ...this.draft, approval };
    this.stage = "applying"; this.render();
    let committed: LearningProgram;
    try {
      committed = withWorkspace
        ? await this.learning.approveLearningWorkspace(this.preview.id, this.operationId)
        : await this.learning.approveLearningProgram(this.preview.id, this.operationId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.stage = "preview"; this.render();
      this.applying = false;
      return;
    }
    // A committed plan must never return to a stale preview, even when
    // optional onboarding data or read-model writes subsequently fail.
    this.readyProgram = committed;
    this.readyObjective = null;
    this.stage = "ready";
    this.error = "";
    try {
      this.draft = { ...this.draft, stage: "ready" };
      await this.learning.saveOnboardingDraft(this.draft);
    } catch {
      // The earlier receipt is already durable: restart can still reconcile it.
      this.error = "Plan saved. Onboarding state could not be updated; recovery is available after restart.";
    }
    await this.projectFirstActivity(committed);
    this.applying = false;
    if (this.parent.isConnected) {
      this.render();
      this.parent.querySelector<HTMLElement>(".nox-empty-title")?.focus();
    }
  }

  private async projectFirstActivity(committed: LearningProgram): Promise<void> {
    this.readyObjective = null;
    try {
      const overview = await this.learning.getProgramOverview();
      const active = await this.learning.getProgramMenuState();
      this.readyObjective = active.activeProgramId === committed.id && !overview?.active &&
        !overview?.focus ? firstOnboardingObjective(committed, overview?.next ?? null) : null;
    } catch {
      this.error = "Your plan was saved, but the next activity is unavailable. Use /progress in chat.";
    }
  }

  /** Crash recovery is a read-first reconciliation, never blind replay of approval. */
  private async recoverApproval(): Promise<void> {
    if (this.applying) return;
    const approval = this.draft.approval;
    if (!approval) {
      this.go("form");
      return;
    }
    const epoch = ++this.requestEpoch;
    this.applying = true;
    this.error = "";
    this.stage = "recovering";
    this.render();
    try {
      const committed = await this.learning.recoverOnboardingApproval(approval);
      if (epoch !== this.requestEpoch) return;
      if (!committed) {
        // The preview lived only in memory. Never fabricate an approval on restart.
        this.draft = { ...this.draft, approval: undefined };
        this.preview = null;
        this.operationId = undefined;
        this.retryWorkspace = null;
        this.stage = "form";
        await this.learning.saveOnboardingDraft({ ...this.draft, stage: "form" });
        this.error = "The previous approval was interrupted before commit. Generate a new blueprint.";
        return;
      }
      this.readyProgram = committed;
      this.stage = "ready";
      await this.learning.saveOnboardingDraft({ ...this.draft, stage: "ready" });
      if (epoch !== this.requestEpoch) return;
      await this.projectFirstActivity(committed);
    } catch (error) {
      if (epoch !== this.requestEpoch) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.stage = "recovering";
    } finally {
      this.applying = false;
      if (epoch === this.requestEpoch && this.parent.isConnected) {
        this.render();
        this.parent.querySelector<HTMLElement>(".nox-empty-title")?.focus();
      }
    }
  }

  private async startFirstObjective(): Promise<void> {
    if (this.launching || !this.readyProgram || !this.readyObjective) return;
    const programId = this.readyProgram.id;
    const objectiveId = this.readyObjective.id;
    this.launching = true;
    this.error = "";
    this.render();
    try {
      await this.callbacks.onStart(programId, objectiveId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.launching = false;
      if (this.parent.isConnected) this.render();
    }
  }

  private render(): void {
    this.parent.empty();
    this.parent.addClass("nox-onboarding");
    const panel = this.parent.createDiv({ cls: "nox-onboarding-body" });
    if (this.stage === "welcome") {
      this.header(panel, "What would you like to learn?",
        "Start with a note, a learning goal, or a question. Set up a workspace later.");
      this.choices(panel, [
        { icon: "book-open", title: "Learn from a note",
          detail: "Explain or practice the open Markdown note",
          click: () => { void this.selectCurrentNote(); } },
        { icon: "target", title: "Start with a goal",
          detail: "Create a quick learning plan without workspace files",
          click: () => {
            this.draft = withOnboardingSource(this.draft); this.go("quick-goal");
          } },
        { icon: "message-circle", title: "Just chat",
          detail: "Ask anything without creating a plan",
          click: () => this.callbacks.onSkip() },
      ]);
    } else if (this.stage === "quick-goal") {
      this.header(panel, "Start with a goal",
        "Create a learning plan now. Workspace files are optional later.");
      this.field(panel, "Learning goal", this.draft.goal, value => { this.draft.goal = value; });
      const actions = panel.createDiv({ cls: "nox-onboarding-actions" });
      this.button(actions, "Back", () => this.go("welcome"));
      const quick = this.button(actions, this.launching ? "Checking provider…" : "Create quick plan",
        () => { void this.startQuickPlan(); }, true);
      quick.disabled = this.launching;
      this.button(panel, "Prefer guided setup?", () => this.go("form"));
      panel.createDiv({ cls: "nox-onboarding-help",
        text: "Quick plan uses /plan with no workspace files. Guided setup offers preview and file approval." });
    } else if (this.stage === "notes") {
      this.header(panel, "Learn from a note",
        "Choose a note in Obsidian. Nox will use its content for the action you select.");
      const source = this.draft.sourcePath;
      const status = panel.createDiv({ cls: "nox-onboarding-help",
        text: source ? `Selected note: ${source}` : "No note selected. Open a Markdown note, then select it." });
      status.setAttribute("role", "status");
      const actions = panel.createDiv({ cls: "nox-onboarding-actions" });
      this.button(actions, "Back", () => this.go("welcome"));
      this.button(actions, "Use current note", () => { void this.selectCurrentNote(); });
      if (source) {
        const explain = this.button(panel, this.launching ? "Checking provider…" : "Explain this note",
          () => { void this.startNoteAction("explain"); }, true);
        const practice = this.button(panel, "Practice this note",
          () => { void this.startNoteAction("practice"); });
        explain.disabled = this.launching;
        practice.disabled = this.launching;
        panel.createDiv({ cls: "nox-onboarding-help",
          text: "This sends the selected note as context to your AI provider. Free practice is not tracked as program mastery." });
      }
    } else if (this.stage === "form") {
      this.header(panel, "Guided setup · preview first",
        "Review measurable objectives and prerequisites before approving workspace files.");
      this.field(panel, "What would you like to achieve?", this.draft.goal, v => { this.draft.goal = v; });
      const advanced = panel.createEl("details", { cls: "nox-onboarding-advanced" });
      advanced.createEl("summary", { text: "Advanced options (optional)" });
      advanced.createDiv({ cls: "nox-onboarding-label", text: "Current level (self-reported)" });
      const levels = advanced.createDiv({ cls: "nox-onboarding-chips" });
      for (const item of ["beginner", "intermediate", "advanced"] as const) {
        const btn = this.button(levels, item, () => {
          this.draft.level = item; this.persist(); this.render();
        });
        btn.toggleClass("is-selected", this.draft.level === item);
      }
      const limits = advanced.createDiv({ cls: "nox-onboarding-limits" });
      for (const spec of [
        { name: "Minutes / session", key: "minutesPerSession" as const, list: [25, 30, 45, 60, 90] },
        { name: "Sessions / week", key: "sessionsPerWeek" as const, list: [1, 2, 3, 4, 5, 6, 7] },
      ]) {
        const field = limits.createDiv();
        field.createEl("label", { cls: "nox-onboarding-label", text: spec.name });
        const select = field.createEl("select", { cls: "nox-onboarding-field" });
        for (const n of spec.list) {
          const option = select.createEl("option", { value: String(n), text: String(n) });
          option.selected = this.draft[spec.key] === n;
        }
        select.addEventListener("change", () => {
          this.draft[spec.key] = Number(select.value);
          this.persist();
        });
      }
      advanced.createEl("label", { cls: "nox-onboarding-label", text: "Deadline (optional)", attr: { for: "nox-learning-deadline" } });
      const deadline = advanced.createEl("input", { cls: "nox-onboarding-field",
        attr: { id: "nox-learning-deadline", type: "date" } });
      deadline.value = this.draft.deadline ?? "";
      deadline.addEventListener("change", () => {
        this.draft.deadline = deadline.value || undefined;
        this.persist();
      });
      panel.createDiv({ cls: "nox-onboarding-help", text: this.draft.sourceBound
        ? `AI source: ${this.draft.sourcePath ?? "current note"}. Its contents will be included in the curriculum request. You can go back to change the source.`
        : "General plan: active-note and selected-note contents will not be included in the curriculum request." });
      this.actions(panel, "Generate blueprint", () => void this.prepare(),
        this.draft.sourceBound ? "notes" : "welcome");
    } else if (this.stage === "generating" || this.stage === "applying") {
      this.header(panel, this.stage === "generating" ? "Preparing your learning plan…" : "Creating workspace…",
        this.stage === "generating" ? "Validating learning outcomes and dependencies." :
          "Writing the approved files to your local vault.");
      panel.createDiv({ cls: "nox-onboarding-help", text: this.stage === "generating"
        ? "You can cancel generation without creating a learning program."
        : "Saving your approved plan. Do not close the vault until this finishes." });
      if (this.stage === "generating") this.button(panel, "Cancel generation", () => {
        this.requestEpoch++;
        this.learning.cancel();
        this.go(this.cancelTo);
      });
    } else if (this.stage === "preview" && this.preview) {
      const p = this.preview;
      this.header(panel, "Review your learning blueprint", p.goal);
      const details = panel.createDiv({ cls: "nox-onboarding-summary" });
      details.createDiv({ text: `${p.objectives.length} objectives · Self-paced focus · No mandatory timer` });
      const work = feasibility(p);
      details.createDiv({ text: `Estimated total: ${work.estimatedMinutes} min including review` });
      if (work.feasible === false) details.createDiv({
        cls: "nox-onboarding-risk",
        text: "Schedule at risk. Reduce scope or increase time before approving.",
      });
      const list = panel.createDiv({ cls: "nox-onboarding-objectives" });
      p.objectives.forEach((objective, index) => {
        const row = list.createDiv({ cls: "nox-onboarding-objective" });
        row.createSpan({ cls: "nox-onboarding-number", text: String(index + 1) });
        const body = row.createDiv();
        body.createDiv({ cls: "nox-onboarding-name", text: objective.title });
        body.createDiv({ cls: "nox-onboarding-detail", text: objective.outcome });
      });
      const path = planWorkspace(p);
      panel.createDiv({ cls: "nox-onboarding-label", text: "Optional workspace files (Create workspace only)" });
      const files = panel.createDiv({ cls: "nox-onboarding-files" });
      for (const file of path.files) files.createDiv({ text: file.path });
      panel.createDiv({ cls: "nox-onboarding-help", text:
        "Lesson notes are generated on demand. Existing files are never overwritten." });
      const actions = panel.createDiv({ cls: "nox-onboarding-actions" });
      if (this.retryWorkspace === null) {
        this.button(actions, "Back", () => this.go("form"));
        this.button(actions, "Use plan only", () => { void this.approve(false); }, true);
        this.button(actions, "Create workspace", () => { void this.approve(true); });
      } else {
        this.button(actions, this.retryWorkspace ? "Retry creating workspace" : "Retry saving plan",
          () => { void this.approve(this.retryWorkspace!); }, true);
      }
    } else if (this.stage === "ready" && this.readyProgram) {
      this.header(panel, "Your learning plan is ready", this.readyProgram.goal);
      panel.createDiv({ cls: "nox-onboarding-summary", text:
        `${this.readyProgram.objectives.length} objectives · Self-paced · ${this.readyProgram.workspaceApproved
          ? "Workspace files approved" : "No workspace files created"}` });
      if (this.readyObjective) {
        const next = panel.createDiv({ cls: "nox-onboarding-objective" });
        next.createDiv({ cls: "nox-onboarding-name", text: this.readyObjective.title });
        next.createDiv({ cls: "nox-onboarding-detail", text: this.readyObjective.outcome });
        const begin = this.button(panel, this.launching ? "Starting objective…" : "Start first objective",
          () => { void this.startFirstObjective(); }, true);
        begin.disabled = this.launching || this.applying;
      } else {
        panel.createDiv({ cls: "nox-onboarding-help",
          text: "You can inspect your next activity from Learning progress in chat." });
      }
      this.button(panel, "Maybe later", () => this.callbacks.onCreated());
    }
    if (this.error) {
      const error = panel.createDiv({ cls: "nox-onboarding-error", text: this.error });
      error.setAttribute("role", "alert");
    }
    animateNoxEnter(panel, 4);
  }
}
