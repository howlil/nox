import {
  createNoxPreviewDocument,
  MAX_VISUAL_SOURCE_CHARS,
  parseNoxChart,
  visualKindFromClasses,
  type NoxChartSpec,
} from "./response-spec";

const SVG_NS = "http://www.w3.org/2000/svg";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function button(label: string): HTMLButtonElement {
  const node = element("button", "nox-visual-action");
  node.type = "button";
  node.textContent = label;
  return node;
}

function svgNode(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function svgText(svg: SVGElement, x: number, y: number, value: string, anchor: string): void {
  const label = svgNode("text", { x: String(x), y: String(y), "text-anchor": anchor,
    class: "nox-chart-text" });
  label.textContent = value;
  svg.appendChild(label);
}

function renderChart(spec: NoxChartSpec): HTMLElement {
  const root = element("section", "nox-visual nox-chart");
  root.setAttribute("aria-label", spec.title ?? spec.type + " chart");

  const header = element("div", "nox-visual-header");
  const title = element("span", "nox-visual-title");
  title.textContent = spec.title || (spec.type === "bar" ? "Bar chart" : "Line chart");
  header.appendChild(title);
  root.appendChild(header);

  const svg = svgNode("svg", { viewBox: "0 0 360 190", role: "img",
    "aria-label": (spec.title ?? spec.type + " chart") + "; data table follows" });
  svg.classList.add("nox-chart-svg");
  const width = 284, left = 54, top = 16, bottom = 144;
  const max = Math.max(1, ...spec.values);
  const ceiling = max * 1.1;
  const y = (value: number) => bottom - (value / ceiling) * (bottom - top);
  const step = width / spec.labels.length;

  for (let tick = 0; tick <= 4; tick++) {
    const value = ceiling * tick / 4;
    const yy = y(value);
    svg.appendChild(svgNode("line", { x1: String(left), y1: String(yy),
      x2: String(left + width), y2: String(yy), class: "nox-chart-grid" }));
    svgText(svg, left - 8, yy + 3, Number(value.toPrecision(3)).toLocaleString("en-US"), "end");
  }

  const points: string[] = [];
  for (let index = 0; index < spec.labels.length; index++) {
    const x = left + (index + 0.5) * step;
    const yy = y(spec.values[index]);
    const caption = spec.labels[index].length > 9 ? spec.labels[index].slice(0, 8) + "…" : spec.labels[index];
    svgText(svg, x, 166, caption, "middle");
    points.push(x + "," + yy);
    if (spec.type === "bar") {
      const bar = svgNode("rect", { x: String(x - Math.min(12, step * 0.35)),
        y: String(yy), width: String(Math.min(24, step * 0.7)),
        height: String(Math.max(0, bottom - yy)), rx: "2", class: "nox-chart-bar" });
      const tooltip = svgNode("title", {});
      tooltip.textContent = spec.labels[index] + ": " + spec.values[index];
      bar.appendChild(tooltip);
      svg.appendChild(bar);
    } else {
      const dot = svgNode("circle", { cx: String(x), cy: String(yy), r: "3.5",
        class: "nox-chart-dot" });
      const tooltip = svgNode("title", {});
      tooltip.textContent = spec.labels[index] + ": " + spec.values[index];
      dot.appendChild(tooltip);
      svg.appendChild(dot);
    }
  }
  if (spec.type === "line") {
    const line = svgNode("polyline", { points: points.join(" "), class: "nox-chart-line" });
    svg.insertBefore(line, svg.querySelector(".nox-chart-dot"));
  }
  root.appendChild(svg);

  const details = element("details", "nox-chart-data");
  const summary = element("summary");
  summary.textContent = "View data";
  details.appendChild(summary);
  const table = element("table");
  const head = element("thead");
  const heading = element("tr");
  for (const label of ["Label", "Value"]) {
    const cell = element("th");
    cell.textContent = label;
    heading.appendChild(cell);
  }
  head.appendChild(heading);
  table.appendChild(head);
  const body = element("tbody");
  for (const [index, label] of spec.labels.entries()) {
    const row = element("tr");
    for (const text of [label, String(spec.values[index])]) {
      const cell = element("td");
      cell.textContent = text;
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  details.appendChild(table);
  root.appendChild(details);
  return root;
}

function renderPreview(
  kind: "html-preview" | "svg-preview", source: string, original: HTMLPreElement,
): HTMLElement {
  const root = element("section", "nox-visual nox-code-preview");
  const header = element("div", "nox-visual-header");
  const title = element("span", "nox-visual-title");
  title.textContent = kind === "html-preview" ? "HTML playground" : "SVG preview";
  const controls = element("div", "nox-visual-controls");
  const preview = button("Run preview");
  const code = button("Code");
  const reset = button("Reset");
  code.setAttribute("aria-pressed", "true");
  preview.setAttribute("aria-pressed", "false");
  reset.hidden = true;
  controls.append(preview, code, reset);
  header.append(title, controls);
  root.appendChild(header);
  const stage = element("div", "nox-visual-stage");
  original.classList.add("nox-visual-source");
  root.appendChild(stage);

  const documentText = createNoxPreviewDocument(kind, source);
  if (!documentText) {
    preview.disabled = true;
    const error = element("p", "nox-visual-warning");
    error.textContent = "Preview unavailable: source is empty or exceeds the 80 KB limit.";
    root.appendChild(error);
    return root;
  }

  const showPreview = () => {
    // Destroy the former execution realm, rather than hiding running scripts.
    stage.replaceChildren();
    const iframe = element("iframe", "nox-visual-frame");
    iframe.title = kind === "html-preview" ? "Isolated HTML preview" : "Isolated SVG preview";
    iframe.setAttribute("sandbox", kind === "html-preview" ? "allow-scripts" : "");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("loading", "lazy");
    iframe.srcdoc = documentText;
    stage.appendChild(iframe);
    preview.setAttribute("aria-pressed", "true");
    code.setAttribute("aria-pressed", "false");
    reset.hidden = false;
  };
  const showCode = () => {
    stage.replaceChildren(original);
    preview.setAttribute("aria-pressed", "false");
    code.setAttribute("aria-pressed", "true");
    reset.hidden = true;
  };
  preview.addEventListener("click", showPreview);
  reset.addEventListener("click", showPreview);
  code.addEventListener("click", showCode);
  return root;
}

/**
 * Post-process native Obsidian Markdown output. Existing prose, Mermaid,
 * math, wikilinks and ordinary code fences stay owned by MarkdownRenderer.
 * The same function is called for completed turns and restored transcripts.
 */
export function enhanceNoxResponseVisuals(content: HTMLElement): number {
  let enhanced = 0;
  for (const code of Array.from(content.querySelectorAll<HTMLElement>("pre > code"))) {
    const pre = code.parentElement;
    if (!(pre instanceof HTMLPreElement)) continue;
    const kind = visualKindFromClasses([...Array.from(code.classList), ...Array.from(pre.classList)]);
    if (!kind) continue;
    const source = code.textContent ?? "";
    if (source.length > MAX_VISUAL_SOURCE_CHARS) {
      const warning = element("p", "nox-visual-warning");
      warning.textContent = "Visual is too large; displaying its source instead.";
      pre.before(warning);
      continue;
    }
    if (kind === "nox-chart") {
      const chart = parseNoxChart(source);
      if (!chart) {
        const warning = element("p", "nox-visual-warning");
        warning.textContent = "Invalid chart data; displaying the original JSON.";
        pre.before(warning);
        continue;
      }
      pre.replaceWith(renderChart(chart));
      enhanced++;
    } else {
      const visual = renderPreview(kind, source, pre);
      pre.replaceWith(visual);
      visual.querySelector(".nox-visual-stage")?.appendChild(pre);
      enhanced++;
    }
  }
  return enhanced;
}
