import {
  createNoxPreviewDocument,
  MAX_VISUAL_SOURCE_CHARS,
  parseNoxChart,
  parseNoxCard,
  parseNoxFlow,
  visualKindFromClasses,
  type NoxChartSpec,
} from "./response-spec";

import { enhanceNoxMarkdownTables, renderNoxCard, renderNoxFlow, renderNoxHorizontalChart } from "./response-rich";
import { setNoxIcon } from "./primitives";
import { bindResponsivePreview } from "./preview-frame";
import type { IconName } from "obsidian";

const SVG_NS = "http://www.w3.org/2000/svg";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function button(label: string, icon: IconName): HTMLButtonElement {
  const node = element("button", "nox-visual-action");
  node.type = "button";
  node.setAttribute("aria-label", label);
  node.title = label;
  setNoxIcon(node, icon);
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
  kind: "html-preview" | "svg-preview" | "js-preview", source: string, original: HTMLPreElement,
): HTMLElement {
  const root = element("section", "nox-visual nox-code-preview");
  const header = element("div", "nox-visual-header");
  const title = element("span", "nox-visual-title");
  title.textContent = kind === "svg-preview" ? "SVG preview" : kind === "js-preview" ? "JavaScript runner" : "HTML playground";
  const controls = element("div", "nox-visual-controls");
  const preview = button("Run preview", "play");
  const code = button("Show source", "code-2");
  const reset = button("Restart preview", "rotate-ccw");
  code.setAttribute("aria-pressed", "true");
  preview.setAttribute("aria-pressed", "false");
  reset.hidden = true;
  controls.append(preview, code, reset);
  header.append(title, controls);
  root.appendChild(header);
  const stage = element("div", "nox-visual-stage");
  original.classList.add("nox-visual-source");
  root.appendChild(stage);

  const previewId = crypto.randomUUID();
  const documentText = createNoxPreviewDocument(kind, source, previewId);
  let releaseFrame: (() => void) | null = null;
  if (!documentText) {
    preview.disabled = true;
    const error = element("p", "nox-visual-warning");
    error.textContent = "Preview unavailable: source is empty or exceeds the 80 KB limit.";
    root.appendChild(error);
    return root;
  }

  const showPreview = () => {
    // Never retain a previous execution realm or its resize listener.
    releaseFrame?.();
    releaseFrame = null;
    stage.replaceChildren();
    const iframe = element("iframe", "nox-visual-frame");
    iframe.title = kind === "svg-preview" ? "Isolated SVG preview" : "Isolated code preview";
    iframe.setAttribute("sandbox", kind === "svg-preview" ? "" : "allow-scripts allow-forms");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("loading", "lazy");
    iframe.srcdoc = documentText;
    stage.appendChild(iframe);
    if (kind !== "svg-preview") releaseFrame = bindResponsivePreview(iframe, previewId);
    preview.setAttribute("aria-pressed", "true");
    code.setAttribute("aria-pressed", "false");
    reset.hidden = false;
  };
  const showCode = () => {
    releaseFrame?.();
    releaseFrame = null;
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


/** Return intrinsic graph bounds (not the parent chat width). Mermaid can have large whitespace. */
function intrinsicMermaidWidth(svg: SVGSVGElement): number {
  const box = svg.viewBox.baseVal;
  let width = box.width || Number.parseFloat(svg.getAttribute("width") ?? "") || 480;
  try {
    const graphics = svg.getBBox();
    if (graphics.width > 20 && graphics.height > 20 &&
        box.width > graphics.width * 1.2 && box.height > graphics.height * 1.2) {
      const margin = 16;
      svg.setAttribute("viewBox", [
        graphics.x - margin, graphics.y - margin,
        graphics.width + margin * 2, graphics.height + margin * 2,
      ].join(" "));
      width = graphics.width + margin * 2;
    }
  } catch { /* Detached or browser-specific SVG: preserve native viewBox. */ }
  return Math.max(160, Math.min(10000, width));
}

/** Obsidian owns Mermaid syntax/rendering; NOX owns responsive framing only. */
export function enhanceNoxMermaidDiagrams(content: HTMLElement): number {
  let count = 0;
  for (const mermaid of Array.from(content.querySelectorAll<HTMLElement>(".mermaid"))) {
    if (mermaid.closest(".nox-diagram") || mermaid.closest(".nox-visual")) continue;
    const svg = mermaid.querySelector<SVGSVGElement>("svg");
    if (!svg) continue;
    const width = Number.parseFloat(svg.getAttribute("width") ?? "");
    const height = Number.parseFloat(svg.getAttribute("height") ?? "");
    if (!svg.hasAttribute("viewBox") && width > 0 && height > 0) {
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    }
    const nativeWidth = intrinsicMermaidWidth(svg);
    const root = element("section", "nox-diagram");
    const toolbar = element("div", "nox-diagram-toolbar");
    const viewport = element("div", "nox-diagram-viewport");
    viewport.tabIndex = 0;
    viewport.setAttribute("role", "region");
    viewport.setAttribute("aria-label", "Mermaid diagram; zoom to inspect");
    const out = button("Zoom out", "minus");
    const fit = button("Fit diagram", "scan");
    const zoomIn = button("Zoom in", "plus");
    const expand = button("Expand diagram", "maximize-2");
    toolbar.append(out, fit, zoomIn, expand);
    mermaid.replaceWith(root);
    root.append(toolbar, viewport);
    viewport.append(mermaid);
    mermaid.dataset.noxSizing = "natural";
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    let zoom = 1;
    const measure = () => {
      // For tiny diagrams, use their natural size instead of stretching to 100%.
      // For wide diagrams, fit the container; zoom activates local horizontal pan.
      if (!root.isConnected) return;
      const available = Math.max(160, viewport.clientWidth - 16);
      const fittedWidth = Math.min(nativeWidth, available);
      mermaid.style.width = Math.round(fittedWidth * zoom) + "px";
      root.style.width = "min(100%, " + Math.ceil(nativeWidth + 16) + "px)";
      out.disabled = zoom <= 0.75;
      zoomIn.disabled = zoom >= 3;
      fit.disabled = zoom === 1;
    };
    out.addEventListener("click", () => { zoom = Math.max(0.75, zoom - 0.25); measure(); });
    zoomIn.addEventListener("click", () => { zoom = Math.min(3, zoom + 0.25); measure(); });
    fit.addEventListener("click", () => {
      zoom = 1;
      measure();
      viewport.scrollTo(0, 0);
    });
    const collapse = () => {
      root.classList.remove("is-expanded");
      expand.setAttribute("aria-label", "Expand diagram");
      expand.title = "Expand diagram";
      setNoxIcon(expand, "maximize-2");
      measure();
    };
    expand.addEventListener("click", () => {
      if (root.classList.contains("is-expanded")) collapse();
      else {
        root.classList.add("is-expanded");
        expand.setAttribute("aria-label", "Close expanded diagram");
        expand.title = "Close expanded diagram";
        setNoxIcon(expand, "minimize-2");
        expand.focus();
        measure();
      }
    });
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && root.classList.contains("is-expanded")) {
        event.preventDefault();
        collapse();
      }
    });
    const resize = new ResizeObserver(() => {
      if (root.isConnected) measure();
      else resize.disconnect();
    });
    resize.observe(viewport);
    measure();
    count++;
  }
  return count;
}

/** Preserve native source selection; add one copy button at the top right. */
function enhanceNoxCodeBlocks(content: HTMLElement): void {
  for (const pre of Array.from(content.querySelectorAll<HTMLPreElement>("pre"))) {
    if (pre.closest(".nox-code-block") || pre.closest(".nox-visual") ||
        pre.closest(".mermaid")) continue;
    const code = pre.querySelector("code");
    if (!code) continue;
    const wrapper = element("section", "nox-code-block");
    const bar = element("div", "nox-code-toolbar");
    const copy = button("Copy code", "copy");
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(code.textContent ?? "").then(() => {
        copy.title = "Copied";
        copy.setAttribute("aria-label", "Copied");
        setNoxIcon(copy, "check");
        window.setTimeout(() => {
          if (!copy.isConnected) return;
          copy.title = "Copy code";
          copy.setAttribute("aria-label", "Copy code");
          setNoxIcon(copy, "copy");
        }, 1400);
      }).catch(() => {
        copy.title = "Copy failed";
        copy.setAttribute("aria-label", "Copy failed");
      });
    });
    bar.append(copy);
    const classes = Array.from(code.classList);
    const kind = classes.some(name => name === "language-js" || name === "language-javascript")
      ? "js-preview" : classes.includes("language-html") ? "html-preview" : null;
    const source = code.textContent ?? "";
    const previewId = crypto.randomUUID();
    const srcdoc = kind ? createNoxPreviewDocument(kind, source, previewId) : null;
    if (srcdoc) {
      const run = button("Run isolated preview", "play");
      const stage = element("div", "nox-visual-stage");
      let running = false;
      let releaseFrame: (() => void) | null = null;
      run.addEventListener("click", () => {
        releaseFrame?.();
        releaseFrame = null;
        stage.replaceChildren();
        if (running) {
          running = false;
          run.title = "Run isolated preview";
          run.setAttribute("aria-label", "Run isolated preview");
          setNoxIcon(run, "play");
          return;
        }
        const iframe = element("iframe", "nox-visual-frame");
        iframe.title = "Isolated code execution";
        iframe.setAttribute("sandbox", "allow-scripts allow-forms");
        iframe.setAttribute("referrerpolicy", "no-referrer");
        iframe.srcdoc = srcdoc;
        stage.append(iframe);
        releaseFrame = bindResponsivePreview(iframe, previewId);
        running = true;
        run.title = "Stop preview";
        run.setAttribute("aria-label", "Stop preview");
        setNoxIcon(run, "square");
      });
      bar.append(run);
      pre.replaceWith(wrapper);
      wrapper.append(bar, pre, stage);
    } else {
      pre.replaceWith(wrapper);
      wrapper.append(bar, pre);
    }
  }
}

/**
 * Post-process native Obsidian Markdown output. Existing prose, Mermaid,
 * math, wikilinks and ordinary code fences stay owned by MarkdownRenderer.
 * The same function is called for completed turns and restored transcripts.
 */
export function enhanceNoxResponseVisuals(content: HTMLElement): number {
  let enhanced = 0;
  enhanceNoxMarkdownTables(content);
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
      pre.replaceWith(chart.type === "horizontal-bar" ? renderNoxHorizontalChart(chart) : renderChart(chart));
      enhanced++;
    } else if (kind === "nox-flow") {
      const flow = parseNoxFlow(source);
      if (!flow) {
        const warning = element("p", "nox-visual-warning");
        warning.textContent = "Invalid flow data; displaying the original JSON.";
        pre.before(warning);
        continue;
      }
      pre.replaceWith(renderNoxFlow(flow));
      enhanced++;
    } else if (kind === "nox-card") {
      const card = parseNoxCard(source);
      if (!card) {
        const warning = element("p", "nox-visual-warning");
        warning.textContent = "Invalid card data; displaying the original JSON.";
        pre.before(warning);
        continue;
      }
      pre.replaceWith(renderNoxCard(card));
      enhanced++;
    } else {
      const visual = renderPreview(kind, source, pre);
      pre.replaceWith(visual);
      visual.querySelector(".nox-visual-stage")?.appendChild(pre);
      enhanced++;
    }
  }
  enhanced += enhanceNoxMermaidDiagrams(content);
  // Obsidian may settle native Mermaid SVGs after MarkdownRenderer resolves.
  // Observe only pending diagrams, for at most three seconds, then disconnect.
  if (Array.from(content.querySelectorAll<HTMLElement>(".mermaid"))
      .some(node => !node.closest(".nox-diagram") && !node.querySelector("svg"))) {
    const observer = new MutationObserver(() => {
      if (!content.isConnected) { observer.disconnect(); return; }
      enhanceNoxMermaidDiagrams(content);
      if (!Array.from(content.querySelectorAll<HTMLElement>(".mermaid"))
          .some(node => !node.closest(".nox-diagram") && !node.querySelector("svg"))) {
        observer.disconnect();
      }
    });
    observer.observe(content, { subtree: true, childList: true });
    window.setTimeout(() => observer.disconnect(), 3000);
  }
  enhanceNoxCodeBlocks(content);
  return enhanced;
}
