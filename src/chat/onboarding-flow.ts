import type { LearningProgram } from "../domain/learning-program/types";
import type { LearningController } from "../application/LearningController";
import type { OnboardingDraft } from "../domain/onboarding/types";
import { planWorkspace } from "../domain/workspace/plan";
import { createNoxButton, setNoxIcon } from "./primitives";
import { animateNoxEnter } from "./motion";

interface Callbacks { onSkip(): void; onCreated(): void; onStart(): void }

/** Native NOX rendering. UI only: business mutations are owned by LearningController. */
export class OnboardingFlow {
  private stage: OnboardingDraft["stage"] = "welcome";
  private draft: OnboardingDraft = {
    version: 1, stage: "welcome", goal: "", interests: [],
    purpose: "career", level: "beginner", minutesPerSession: 45, sessionsPerWeek: 3,
    sourceBound: false,
  };
  private preview: LearningProgram | null = null;
  private directions: Array<{ title: string; outcome: string }> = [];
  private error = "";
  private applying = false;
  private operationId?: string;
  private requestEpoch = 0;
  private cancelTo: OnboardingDraft["stage"] = "form";

  constructor(private readonly parent: HTMLElement, private readonly learning: LearningController,
    private readonly callbacks: Callbacks, initial?: OnboardingDraft) {
    if (initial?.version === 1) {
      this.draft = initial;
      this.stage = ["generating", "preview", "applying", "ready"].includes(initial.stage)
        ? "form" : initial.stage;
    }
    this.render();
  }

  private persist(): void {
    this.draft.stage = this.stage;
    void this.learning.saveOnboardingDraft(this.draft).catch(error => {
      console.warn("[Nox] Could not save onboarding draft", error);
    });
  }
  private go(stage: OnboardingDraft["stage"]): void {
    this.stage = stage;
    this.error = "";
    this.persist();
    this.render();
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
    panel.createDiv({ cls: "nox-empty-title", text: title });
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
  private async discover(): Promise<void> {
    const epoch = ++this.requestEpoch;
    this.cancelTo = "discovery";
    this.stage = "generating";
    this.render();
    try {
      const directions = await this.learning.discoverLearningDirections(this.draft.interests, this.draft.purpose);
      if (epoch !== this.requestEpoch) return;
      this.directions = directions;
      this.go("suggestions");
    } catch (error) {
      if (epoch !== this.requestEpoch) return;
      this.error = error instanceof Error ? error.message : String(error);
      this.stage = "discovery";
      this.render();
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
      const constraints = {
        minutesPerSession: this.draft.minutesPerSession, sessionsPerWeek: this.draft.sessionsPerWeek,
        sourceBound: this.draft.sourceBound,
        sourcePaths: this.draft.sourcePath ? [this.draft.sourcePath] : [], excludedTopics: [],
      };
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
  private async approve(): Promise<void> {
    if (!this.preview || !this.operationId || this.applying) return;
    this.applying = true;
    this.stage = "applying"; this.render();
    try {
      await this.learning.approveLearningWorkspace(this.preview.id, this.operationId);
      await this.learning.dismissOnboarding();
      this.callbacks.onCreated();
    } catch (error) {
      // A program may already have committed; a retry reuses the same operation ID.
      this.error = error instanceof Error ? error.message : String(error);
      this.stage = "preview"; this.render();
    } finally { this.applying = false; }
  }
  private render(): void {
    this.parent.empty();
    this.parent.addClass("nox-onboarding");
    const panel = this.parent.createDiv({ cls: "nox-onboarding-body" });
    if (this.stage === "welcome") {
      this.header(panel, "What would you like to learn?",
        "Build a learning path or try Nox without setting up a program.");
      this.choices(panel, [
        { icon: "target", title: "I have a goal", detail: "Create a learning plan", click: () => {
          this.draft.sourceBound = false; this.draft.sourcePath = undefined; this.go("form");
        } },
        { icon: "compass", title: "Help me decide", detail: "Explore learning directions",
          click: () => this.go("discovery") },
        { icon: "book-open", title: "Use my notes", detail: "Learn from current material",
          click: () => this.go("notes") },
        { icon: "message-circle", title: "Just explore", detail: "Chat without a plan",
          click: () => this.callbacks.onSkip() },
      ]);
      panel.createDiv({ cls: "nox-onboarding-help", text:
        "Nothing is written to your vault until you approve a blueprint." });
    } else if (this.stage === "discovery") {
      this.header(panel, "Find a direction", "Choose your interests. Nox will suggest three possible goals.");
      const interests = ["Technology", "Languages", "Finance", "Science", "Design", "Writing"];
      const options = panel.createDiv({ cls: "nox-onboarding-chips" });
      for (const interest of interests) {
        const selected = this.draft.interests.includes(interest);
        const btn = this.button(options, interest, () => {
          this.draft.interests = selected
            ? this.draft.interests.filter(x => x !== interest)
            : [...this.draft.interests, interest];
          this.persist(); this.render();
        });
        btn.toggleClass("is-selected", selected);
        btn.setAttribute("aria-pressed", String(selected));
      }
      panel.createDiv({ cls: "nox-onboarding-label", text: "Learning motivation" });
      const motivations = panel.createDiv({ cls: "nox-onboarding-chips" });
      for (const item of ["career", "project", "curiosity"] as const) {
        const btn = this.button(motivations, item, () => {
          this.draft.purpose = item; this.persist(); this.render();
        });
        btn.toggleClass("is-selected", this.draft.purpose === item);
        btn.setAttribute("aria-pressed", String(this.draft.purpose === item));
      }
      this.actions(panel, "Find directions", () => void this.discover());
    } else if (this.stage === "suggestions") {
      this.header(panel, "Suggested directions", "Select one to customize its learning outcome.");
      this.choices(panel, this.directions.map(x => ({
        icon: "target" as const, title: x.title, detail: x.outcome,
        click: () => { this.draft.goal = x.title; this.draft.sourceBound = false; this.draft.sourcePath = undefined; this.go("form"); },
      })));
      this.button(panel, "Back to interests", () => this.go("discovery"));
    } else if (this.stage === "notes") {
      this.header(panel, "Learn from your notes",
        "Open a Markdown note in Obsidian, then generate a source-limited plan.");
      const status = panel.createDiv({ cls: "nox-onboarding-help",
        text: "Nox uses your current note. It will not invent a source for an empty vault." });
      status.setAttribute("role", "status");
      this.actions(panel, "Use current note", async () => {
        try {
          const ctx = await this.learning.getOnboardingContext();
          if (!ctx.activeNote) throw new Error("Open a Markdown note before continuing.");
          this.draft.goal = this.draft.goal || "Understand " + ctx.activeNote.split("/").pop();
          this.draft.sourceBound = true;
          this.draft.sourcePath = ctx.activeNote;
          this.go("form");
        } catch (error) {
          this.error = error instanceof Error ? error.message : String(error);
          this.render();
        }
      });
    } else if (this.stage === "form") {
      this.header(panel, "Build your learning path",
        "Your goal becomes measurable objectives and prerequisite relationships.");
      this.field(panel, "What would you like to achieve?", this.draft.goal, v => { this.draft.goal = v; });
      panel.createDiv({ cls: "nox-onboarding-label", text: "Current level (self-reported)" });
      const levels = panel.createDiv({ cls: "nox-onboarding-chips" });
      for (const item of ["beginner", "intermediate", "advanced"] as const) {
        const btn = this.button(levels, item, () => {
          this.draft.level = item; this.persist(); this.render();
        });
        btn.toggleClass("is-selected", this.draft.level === item);
      }
      const limits = panel.createDiv({ cls: "nox-onboarding-limits" });
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
      if (this.draft.sourceBound) panel.createDiv({ cls: "nox-onboarding-help", text: `Source: ${this.draft.sourcePath ?? "active note"}` });
      this.actions(panel, "Generate blueprint", () => void this.prepare(),
        this.draft.sourceBound ? "notes" : "welcome");
    } else if (this.stage === "generating" || this.stage === "applying") {
      this.header(panel, this.stage === "generating" ? "Preparing your learning plan…" : "Creating workspace…",
        this.stage === "generating" ? "Validating learning outcomes and dependencies." :
          "Writing the approved files to your local vault.");
      panel.createDiv({ cls: "nox-onboarding-help", text: "You can cancel without creating a learning program." });
      if (this.stage === "generating") this.button(panel, "Cancel generation", () => {
        this.requestEpoch++;
        this.learning.cancel();
        this.go(this.cancelTo);
      });
    } else if (this.stage === "preview" && this.preview) {
      const p = this.preview;
      this.header(panel, "Review your learning blueprint", p.goal);
      const details = panel.createDiv({ cls: "nox-onboarding-summary" });
      details.createDiv({ text: `${p.objectives.length} objectives · ${p.constraints.minutesPerSession} min · ${p.constraints.sessionsPerWeek} sessions/week` });
      const list = panel.createDiv({ cls: "nox-onboarding-objectives" });
      p.objectives.forEach((objective, index) => {
        const row = list.createDiv({ cls: "nox-onboarding-objective" });
        row.createSpan({ cls: "nox-onboarding-number", text: String(index + 1) });
        const body = row.createDiv();
        body.createDiv({ cls: "nox-onboarding-name", text: objective.title });
        body.createDiv({ cls: "nox-onboarding-detail", text: objective.outcome });
      });
      const path = planWorkspace(p);
      panel.createDiv({ cls: "nox-onboarding-label", text: "Files to create (after approval)" });
      const files = panel.createDiv({ cls: "nox-onboarding-files" });
      for (const file of path.files) files.createDiv({ text: file.path });
      panel.createDiv({ cls: "nox-onboarding-help", text:
        "Lesson notes are generated on demand. Existing files are never overwritten." });
      this.actions(panel, "Create workspace", () => void this.approve(), "form");
    }
    if (this.error) {
      const error = panel.createDiv({ cls: "nox-onboarding-error", text: this.error });
      error.setAttribute("role", "alert");
    }
    animateNoxEnter(panel, 4);
  }
}
