import type { LearningPanelState, LearningPanelAction } from "./learning-panel-state";
import { createNoxButton, setNoxIcon } from "./primitives";

export function renderAdaptiveLearningPanel(
  parent: HTMLElement, state: LearningPanelState, onCommand: (command: string) => void,
): HTMLElement {
  const root = parent.createDiv({ cls: "nox-adaptive-panel" });
  const addActions = (container: HTMLElement, actions: LearningPanelAction[]) => {
    const footer = container.createDiv({ cls: "nox-adaptive-actions" });
    for (const action of actions) {
      const button = createNoxButton(footer, {
        text: action.label, variant: action.command.startsWith("/approve") ||
          action.command === "/next" || action.command === "/resume-focus"
          ? "primary" : "quiet",
      });
      if (action.destructive) button.addClass("nox-adaptive-action-subtle");
      button.addEventListener("click", () => onCommand(action.command));
    }
  };
  if (state.focus) {
    const focus = root.createDiv({ cls: "nox-adaptive-focus" });
    focus.dataset.status = state.focus.status;
    const head = focus.createDiv({ cls: "nox-adaptive-focus-head" });
    const icon = head.createSpan({ cls: "nox-adaptive-icon" });
    setNoxIcon(icon, state.focus.status === "paused" ? "pause-circle" : "target");
    const body = head.createDiv();
    body.createDiv({ cls: "nox-adaptive-eyebrow", text:
      state.focus.status === "paused" ? "Focus paused" : "Current objective" });
    body.createDiv({ cls: "nox-adaptive-title", text: state.focus.title });
    focus.createDiv({ cls: "nox-inspector-muted", text:
      "Self-paced · No mandatory timer · Mastery requires independent recall" });
    const criteria = focus.createEl("details", { cls: "nox-adaptive-criteria" });
    const summary = criteria.createEl("summary");
    summary.setText("Rubric criteria (" +
      state.focus.criteria.filter(c => c.status === "verified").length + "/" +
      state.focus.criteria.length + " verified)");
    const list = criteria.createEl("ul", { cls: "nox-adaptive-criterion-list" });
    for (const criterion of state.focus.criteria) {
      const row = list.createEl("li", { cls: "nox-adaptive-criterion" });
      row.dataset.status = criterion.status;
      row.createSpan({ cls: "nox-adaptive-criterion-title", text: criterion.title });
      row.createSpan({ cls: "nox-adaptive-criterion-status", text:
        criterion.status.replace(/-/g, " ") });
      if (criterion.evidenceIds.length > 0) {
        const evidence = row.createEl("details", { cls: "nox-adaptive-evidence" });
        evidence.createEl("summary", { text: "Evidence" });
        evidence.createDiv({ text: criterion.evidenceIds.join(", ") });
      }
    }
    addActions(focus, state.focus.actions);
  }
  if (state.revision) {
    const revision = root.createDiv({ cls: "nox-adaptive-revision", attr: {
      role: "region", "aria-label": "Curriculum revision awaiting approval",
    } });
    revision.createDiv({ cls: "nox-adaptive-eyebrow", text: "Curriculum change · Preview only" });
    revision.createDiv({ cls: "nox-adaptive-title",
      text: "Revision " + state.revision.fromVersion + " → " + state.revision.toVersion });
    revision.createDiv({ cls: "nox-inspector-muted", text:
      "Reason: " + state.revision.reason + ". No changes will be saved until you approve." });
    const list = revision.createEl("ul", { cls: "nox-adaptive-revision-list" });
    for (const change of state.revision.changes) {
      list.createEl("li", { text: change });
    }
    const evidence = revision.createEl("details", { cls: "nox-adaptive-evidence" });
    evidence.createEl("summary", { text: "Supporting evidence" });
    evidence.createDiv({ text: state.revision.evidenceIds.join(", ") ||
      "Explicit goal-change request" });
    addActions(revision, state.revision.actions);
  }
  if (state.next.trigger || state.next.criteria.length) {
    const next = root.createEl("details", { cls: "nox-adaptive-why" });
    next.createEl("summary", { text: "Why this activity?" });
    if (state.next.trigger) next.createDiv({ text: state.next.trigger.replace(/-/g, " ") });
    if (state.next.criteria.length) next.createDiv({ text:
      "Target criteria: " + state.next.criteria.join(", ") });
    if (state.next.dueAt !== undefined) next.createDiv({ text:
      "Recall: " + new Date(state.next.dueAt).toLocaleString() });
  }
  return root;
}
