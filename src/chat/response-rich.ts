import { setNoxIcon } from "./primitives";
import { layoutNoxFlow } from "./response-graph-layout";
import type { NoxCardSpec, NoxChartSpec, NoxFlowSpec } from "./response-spec";

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}
function svgEl(tag: string, attrs: Record<string, string> = {}): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function heading(root: HTMLElement, title: string, caption?: string): void {
  const top = el("div", "nox-rich-heading");
  const label = el("strong", "nox-rich-title");
  label.textContent = title;
  top.append(label);
  root.append(top);
  if (caption) {
    const description = el("p", "nox-rich-caption");
    description.textContent = caption;
    root.append(description);
  }
}
function icon(name: string): HTMLElement {
  const node = el("span", "nox-rich-icon");
  setNoxIcon(node, name);
  node.setAttribute("aria-hidden", "true");
  return node;
}

const STATUS_ICON: Record<NonNullable<NoxCardSpec["items"][number]["status"]>, string> = {
  success: "check-circle-2",
  pending: "clock-3",
  warning: "alert-triangle",
  error: "x-circle",
};

export function renderNoxCard(spec: NoxCardSpec): HTMLElement {
  const root = el("section", "nox-visual nox-rich-card nox-rich-card--" + spec.kind);
  root.setAttribute("aria-label", spec.title);
  heading(root, spec.title, spec.description);
  if (spec.kind === "status-table") {
    const scroll = el("div", "nox-response-table-scroll");
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", spec.title + " table");
    scroll.tabIndex = 0;
    const table = el("table", "nox-rich-status-table");
    const thead = el("thead"), tr = el("tr");
    for (const name of ["Item", "Description", "Status"]) {
      const th = el("th");
      th.scope = "col";
      th.textContent = name;
      tr.append(th);
    }
    thead.append(tr);
    table.append(thead);
    const tbody = el("tbody");
    for (const entry of spec.items) {
      const row = el("tr");
      const name = el("td"), detail = el("td"), status = el("td", "nox-rich-status");
      name.textContent = entry.label;
      detail.textContent = entry.detail ?? "";
      status.dataset.status = entry.status ?? "pending";
      if (entry.status) status.append(icon(STATUS_ICON[entry.status]));
      const label = el("span");
      label.textContent = String(entry.value);
      status.append(label);
      row.append(name, detail, status);
      tbody.append(row);
    }
    table.append(tbody);
    scroll.append(table);
    root.append(scroll);
  } else {
    const grid = el("div", "nox-rich-metrics");
    for (const entry of spec.items) {
      const item = el("div", "nox-rich-metric");
      const label = el("span", "nox-rich-metric-label");
      label.textContent = entry.label;
      const main = el("div", "nox-rich-metric-value");
      const value = el("strong");
      value.textContent = String(entry.value);
      main.append(value);
      if (entry.unit) {
        const unit = el("span", "nox-rich-metric-unit");
        unit.textContent = entry.unit;
        main.append(unit);
      }
      item.append(label, main);
      if (entry.detail) {
        const detail = el("span", "nox-rich-metric-detail");
        detail.textContent = entry.detail;
        item.append(detail);
      }
      grid.append(item);
    }
    root.append(grid);
  }
  return root;
}

function wrapLabel(text: string): string[] {
  const words = text.split(/\\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && (current + " " + word).length > 29) {
      lines.push(current);
      current = word;
    } else current = current ? current + " " + word : word;
  }
  if (current) lines.push(current);
  if (lines.length > 2 || lines.some(line => line.length > 34)) {
    return [text.slice(0, 29), text.length > 29 ? text.slice(29, 54).trimEnd() + "…" : ""].filter(Boolean);
  }
  return lines;
}

export function renderNoxFlow(spec: NoxFlowSpec): HTMLElement {
  const layout = layoutNoxFlow(spec);
  const root = el("section", "nox-visual nox-rich-flow");
  root.setAttribute("aria-label", spec.title ?? "Top-down flow diagram");
  heading(root, spec.title ?? "Flow diagram");
  const viewport = el("div", "nox-rich-flow-viewport");
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", "Scroll vertically to inspect all diagram steps");
  const svg = svgEl("svg", {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width: String(layout.width), height: String(layout.height),
    role: "img", "aria-label": `${layout.nodes.length} steps, ${layout.edges.length} connections. Connections listed below.`,
  });
  svg.classList.add("nox-rich-flow-svg");
  const defs = svgEl("defs");
  const markerId = "nox-flow-arrow-" + crypto.randomUUID();
  const marker = svgEl("marker", {
    id: markerId, viewBox: "0 0 10 10", refX: "9", refY: "5",
    markerWidth: "6", markerHeight: "6", orient: "auto-start-reverse",
  });
  marker.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "nox-flow-arrow" }));
  defs.append(marker);
  svg.append(defs);
  for (const edge of layout.edges) {
    const path = svgEl("path", { d: edge.path, class: "nox-flow-edge",
      "marker-end": `url(#${markerId})` });
    const title = svgEl("title");
    title.textContent = edge.from + " → " + edge.to + (edge.label ? ": " + edge.label : "");
    path.append(title);
    svg.append(path);
  }
  for (const node of layout.nodes) {
    const group = svgEl("g", { class: "nox-flow-node", "data-kind": node.kind ?? "default" });
    const rect = svgEl("rect", {
      x: String(node.x), y: String(node.y), width: String(node.width),
      height: String(node.height), rx: "9",
    });
    const title = svgEl("title");
    title.textContent = node.label;
    group.append(rect, title);
    const lines = wrapLabel(node.label);
    for (const [index, line] of lines.entries()) {
      const text = svgEl("text", {
        x: String(node.x + node.width / 2),
        y: String(node.y + node.height / 2 + (index - (lines.length - 1) / 2) * 14 + 4),
        "text-anchor": "middle",
      });
      text.textContent = line;
      group.append(text);
    }
    svg.append(group);
  }
  viewport.append(svg);
  root.append(viewport);
  const details = el("details", "nox-rich-flow-details");
  const summary = el("summary");
  summary.textContent = "View steps and connections";
  details.append(summary);
  const list = el("ol");
  const incoming = new Map<string, string[]>();
  for (const edge of spec.edges) {
    const sources = incoming.get(edge.to) ?? [];
    sources.push(edge.from);
    incoming.set(edge.to, sources);
  }
  const names = new Map(spec.nodes.map(node => [node.id, node.label]));
  for (const node of layout.nodes) {
    const li = el("li");
    const sources = incoming.get(node.id) ?? [];
    li.textContent = node.label + (sources.length
      ? " — from " + sources.map(id => names.get(id) ?? id).join(", ") : " — start");
    list.append(li);
  }
  details.append(list);
  root.append(details);
  return root;
}

/** Read-only proportional horizontal bars, with exact values mirrored in a data table. */
export function renderNoxHorizontalChart(spec: NoxChartSpec): HTMLElement {
  const root = el("section", "nox-visual nox-rich-chart");
  root.setAttribute("aria-label", spec.title ?? "Horizontal bar chart");
  heading(root, spec.title ?? "Comparison");
  const bars = el("div", "nox-rich-bars");
  const max = Math.max(1, ...spec.values);
  for (const [index, label] of spec.labels.entries()) {
    const row = el("div", "nox-rich-bar-row");
    const name = el("span", "nox-rich-bar-label");
    name.textContent = label;
    const track = el("div", "nox-rich-bar-track");
    const fill = el("span", "nox-rich-bar-fill");
    fill.style.width = String(Math.max(0, Math.min(100, spec.values[index] / max * 100))) + "%";
    track.append(fill);
    const value = el("span", "nox-rich-bar-value");
    value.textContent = spec.values[index].toLocaleString("en-US");
    row.append(name, track, value);
    bars.append(row);
  }
  root.append(bars);
  const details = el("details", "nox-chart-data");
  const summary = el("summary");
  summary.textContent = "View data";
  details.append(summary);
  const table = el("table");
  const head = el("tr");
  for (const name of ["Label", "Value"]) {
    const th = el("th");
    th.textContent = name;
    th.scope = "col";
    head.append(th);
  }
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const body = el("tbody");
  spec.labels.forEach((label, index) => {
    const row = el("tr");
    const name = el("td"), value = el("td");
    name.textContent = label;
    value.textContent = String(spec.values[index]);
    row.append(name, value);
    body.append(row);
  });
  table.append(body);
  details.append(table);
  root.append(details);
  return root;
}

/** Enhance only native Markdown tables, never mutate headings or data content. */
export function enhanceNoxMarkdownTables(content: HTMLElement): void {
  for (const table of Array.from(content.querySelectorAll<HTMLTableElement>("table"))) {
    if (table.closest(".nox-visual") || table.closest(".nox-response-table-scroll")) continue;
    const wrapper = el("div", "nox-response-table-scroll");
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Response table, scroll horizontally when needed");
    table.before(wrapper);
    wrapper.append(table);
    for (const th of Array.from(table.querySelectorAll("thead th"))) th.scope = "col";
    const lookup: Record<string, { status: string; icon: string }> = {
      done: { status: "success", icon: "check-circle-2" },
      completed: { status: "success", icon: "check-circle-2" },
      pending: { status: "pending", icon: "clock-3" },
      "not tested": { status: "pending", icon: "clock-3" },
      "belum diuji": { status: "pending", icon: "clock-3" },
      "in progress": { status: "pending", icon: "loader-circle" },
      blocked: { status: "warning", icon: "alert-triangle" },
      failed: { status: "error", icon: "x-circle" },
    };
    for (const tr of Array.from(table.querySelectorAll("tbody tr"))) {
      const td = tr.querySelector("td:last-child");
      if (!td || td.children.length > 0) continue;
      const state = lookup[(td.textContent ?? "").trim().toLowerCase()];
      if (!state) continue;
      td.dataset.status = state.status;
      const glyph = icon(state.icon);
      glyph.classList.add("nox-rich-inline-status");
      td.prepend(glyph);
    }
  }
}
