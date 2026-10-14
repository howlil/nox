import type { LearningObjective, ActivityKind } from "../domain/learning-program/types";
import { createNoxButton, setNoxIcon } from "./primitives";

export interface NoxProgramOverview {
  goal: string;
  active: boolean;
  next: { kind: ActivityKind; objectiveId?: string; reason: string };
  objectives: Array<{ objective: LearningObjective;
    status: "unseen" | "remediate" | "provisional" | "mastered";
    attempts: number; dueAt: number | null }>;
}

/** Accessible dependency-level navigator. The application owns every learning decision. */
export function renderLearningGraph(
  parent: HTMLElement,
  overview: NoxProgramOverview | null,
  onClose: () => void,
  onNext: () => void,
): HTMLElement {
  const root = parent.createDiv({ cls: "nox-learning-graph" });
  parent.prepend(root);
  const head = root.createDiv({ cls: "nox-learning-graph-head" });
  head.createDiv({ cls: "nox-inspector-heading", text: "Learning map" });
  const close = createNoxButton(head, { variant: "quiet", text: "Close", label: "Close learning map" });
  close.addEventListener("click", onClose);
  if (!overview) {
    root.createDiv({ cls: "nox-inspector-placeholder", text: "No active learning program. Use /plan to create one." });
    return root;
  }
  root.createDiv({ cls: "nox-learning-graph-goal", text: overview.goal });
  const mastered = overview.objectives.filter(item => item.status === "mastered").length;
  root.createDiv({ cls: "nox-inspector-muted", text: `${mastered} of ${overview.objectives.length} mastered · Mastery requires independent recall` });
  const track = root.createDiv({ cls: "nox-learning-graph-track", attr: { role: "progressbar",
    "aria-label": "Mastered learning objectives", "aria-valuemin": "0",
    "aria-valuemax": String(overview.objectives.length), "aria-valuenow": String(mastered) } });
  const fill = track.createDiv();
  fill.style.width = (overview.objectives.length ? (mastered / overview.objectives.length) * 100 : 0) + "%";
  const levels = new Map<string, number>();
  const nodes = new Map(overview.objectives.map(item => [item.objective.id, item.objective]));
  function depth(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    const node = nodes.get(id);
    if (!node) return 0;
    const value = node.prerequisiteIds.length
      ? 1 + Math.max(...node.prerequisiteIds.map(depth)) : 0;
    levels.set(id, value);
    return value;
  }
  for (const item of overview.objectives) depth(item.objective.id);
  const ordered = [...overview.objectives].sort((a, b) =>
    depth(a.objective.id) - depth(b.objective.id) || a.objective.title.localeCompare(b.objective.title));
  for (const item of ordered) {
    const node = root.createEl("details", { cls: "nox-graph-node" });
    node.dataset.status = item.status;
    const summary = node.createEl("summary");
    const icon = summary.createSpan({ cls: "nox-graph-node-icon" });
    setNoxIcon(icon, item.status === "mastered" ? "check-circle-2" :
      item.status === "remediate" ? "alert-circle" : "circle");
    summary.createSpan({ cls: "nox-graph-node-name", text: item.objective.title });
    summary.createSpan({ cls: "nox-inspector-muted", text: item.status });
    const body = node.createDiv({ cls: "nox-graph-node-body" });
    body.createDiv({ text: item.objective.outcome });
    const deps = item.objective.prerequisiteIds.map(id => nodes.get(id)?.title ?? id);
    if (deps.length) body.createDiv({ cls: "nox-inspector-muted", text: "Requires: " + deps.join(", ") });
    body.createDiv({ cls: "nox-inspector-muted",
      text: `${item.attempts} assessed attempts · ${item.objective.estimatedMinutes} min estimate` });
    if (item.dueAt !== null) body.createDiv({ cls: "nox-inspector-muted",
      text: "Next recall: " + new Date(item.dueAt).toLocaleString() });
    if (item.objective.sourceRefs.length) body.createDiv({ cls: "nox-inspector-muted",
      text: "Sources: " + item.objective.sourceRefs.join(", ") });
  }
  const next = root.createDiv({ cls: "nox-graph-next" });
  next.createDiv({ cls: "nox-inspector-heading", text: "Recommended next" });
  next.createDiv({ text: overview.next.reason });
  const action = createNoxButton(next, { variant: "secondary",
    text: overview.active ? "Continue" : "Start session" });
  action.addEventListener("click", onNext);
  return root;
}
