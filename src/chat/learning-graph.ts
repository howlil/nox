import type { NoxProgramOverview } from "../application/learning-types";
import { createNoxButton, setNoxIcon } from "./primitives";
import { layoutLearningMap, LEARNING_MAP_NODE_SIZE, type LearningMapLayout } from "./learning-graph-layout";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Read-only spatial overview; the accessible details below remain the action surface. */
function appendDependencyDiagram(parent: HTMLElement, layout: LearningMapLayout): void {
  if (layout.problem) {
    parent.createDiv({ cls: "nox-inspector-muted", text: layout.problem === "cycle"
      ? "A prerequisite cycle was detected. Showing the objective details instead."
      : "This plan is too large for the compact map. Browse the objectives below." });
    return;
  }
  if (!layout.nodes.length) return;
  const scroller = parent.createDiv({ cls: "nox-learning-map-scroll" });
  scroller.setAttribute("tabindex", "0");
  scroller.setAttribute("role", "region");
  scroller.setAttribute("aria-label", "Prerequisite graph; scroll vertically to explore");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("nox-learning-map-svg");
  svg.setAttribute("viewBox", "0 0 " + layout.width + " " + layout.height);
  svg.setAttribute("width", String(layout.width));
  svg.setAttribute("height", String(layout.height));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", layout.nodes.length + " objectives and " + layout.edges.length + " prerequisite connections");
  const arrowId = "nox-learning-arrow-" + crypto.randomUUID();
  const defs = document.createElementNS(SVG_NS, "defs");
  const marker = document.createElementNS(SVG_NS, "marker");
  for (const [key, value] of Object.entries({ id: arrowId, viewBox: "0 0 10 10", refX: "9", refY: "5",
    markerWidth: "5", markerHeight: "5", orient: "auto" })) marker.setAttribute(key, value);
  const arrow = document.createElementNS(SVG_NS, "path");
  arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
  arrow.classList.add("nox-learning-map-arrow");
  marker.appendChild(arrow);
  defs.appendChild(marker);
  svg.appendChild(defs);
  for (const [index, edge] of layout.edges.entries()) {
    const path = document.createElementNS(SVG_NS, "path");
    const direct = edge.y2 - edge.y1 < 42;
    if (direct) {
      path.setAttribute("d", `M ${edge.x1} ${edge.y1} L ${edge.x2} ${edge.y2 - 6}`);
    } else {
      const rail = index % 2 === 0 ? 10 : layout.width - 10;
      path.setAttribute("d", `M ${edge.x1} ${edge.y1} L ${edge.x1} ${edge.y1 + 7} Q ${edge.x1} ${edge.y1 + 12} ${rail} ${edge.y1 + 12} L ${rail} ${edge.y2 - 12} Q ${rail} ${edge.y2 - 6} ${edge.x2} ${edge.y2 - 6}`);
    }
    path.setAttribute("marker-end", `url(#${arrowId})`);
    path.classList.add("nox-learning-map-edge");
    svg.appendChild(path);
  }
  for (const node of layout.nodes) {
    const group = document.createElementNS(SVG_NS, "g");
    group.classList.add("nox-learning-map-node");
    group.setAttribute("data-status", node.status);
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(node.x));
    rect.setAttribute("y", String(node.y));
    rect.setAttribute("rx", "7");
    rect.setAttribute("width", String(LEARNING_MAP_NODE_SIZE.width));
    rect.setAttribute("height", String(LEARNING_MAP_NODE_SIZE.height));
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = node.title + " · " + node.status;
    group.append(rect, title);
    for (const [index, line] of [node.title.length > 23 ? node.title.slice(0, 22) + "…" : node.title,
      node.status].entries()) {
      const text = document.createElementNS(SVG_NS, "text");
      text.classList.add(index === 0 ? "nox-learning-map-title" : "nox-learning-map-status");
      text.setAttribute("x", String(node.x + 10));
      text.setAttribute("y", String(node.y + (index === 0 ? 17 : 31)));
      text.textContent = line;
      group.appendChild(text);
    }
    svg.appendChild(group);
  }
  scroller.appendChild(svg);
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
  const layout = layoutLearningMap(overview.objectives.map(item => ({
    id: item.objective.id, title: item.objective.title, status: item.status,
    prerequisiteIds: item.objective.prerequisiteIds,
  })));
  appendDependencyDiagram(root, layout);
  const nodes = new Map(overview.objectives.map(item => [item.objective.id, item.objective]));
  const levels = new Map(layout.nodes.map(node => [node.id, node.level]));
  const ordered = [...overview.objectives].sort((a, b) =>
    (levels.get(a.objective.id) ?? 0) - (levels.get(b.objective.id) ?? 0) ||
    a.objective.title.localeCompare(b.objective.title));
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
