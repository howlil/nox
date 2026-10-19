import type { NoxFlowSpecV2 } from "./response-graph-v2-schema";
import { layoutNoxFlowV2, type NoxFlowV2Layout } from "./response-graph-v2-layout";
import { mountNoxGraphViewport } from "./graph-viewport";

const NS = "http://www.w3.org/2000/svg";
function svgElement(doc: Document, tag: string, attrs: Record<string, string> = {}): SVGElement {
  const element = doc.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  return element;
}
const clipped = (s: string, max = 44): string => s.length > max ? s.slice(0, max - 1) + "…" : s;

function text(doc: Document, parent: SVGElement, value: string,
              x: number, y: number, cls: string): SVGElement {
  const result = svgElement(doc, "text", {
    x: String(x), y: String(y), class: cls, "text-anchor": "middle",
  });
  result.textContent = value;
  parent.append(result);
  return result;
}

function drawGraph(doc: Document, spec: NoxFlowSpecV2, layout: NoxFlowV2Layout): SVGSVGElement {
  const svg = svgElement(doc, "svg", {
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    role: "img",
    "aria-label": `${spec.title ?? "Graph"}: ${layout.nodes.length} nodes, ${layout.edges.length} edges; textual connections follow`,
  }) as SVGSVGElement;
  svg.classList.add("nox-rich-flow-svg", "nox-graph-v2-svg");
  const defs = svgElement(doc, "defs");
  const markerId = "nox-graph-v2-arrow-" + crypto.randomUUID();
  const marker = svgElement(doc, "marker", {
    id: markerId, viewBox: "0 0 10 10", refX: "9", refY: "5",
    markerWidth: "6", markerHeight: "6", orient: "auto",
  });
  marker.append(svgElement(doc, "path", {
    d: "M 0 0 L 10 5 L 0 10 z", class: "nox-flow-arrow",
  }));
  defs.append(marker);
  svg.append(defs);

  // Background groups must appear beneath routed edges and nodes.
  for (const group of layout.groups) {
    const container = svgElement(doc, "g", { class: "nox-graph-v2-group" });
    container.append(svgElement(doc, "rect", {
      x: String(group.x), y: String(group.y),
      width: String(group.width), height: String(group.height),
      rx: "12",
    }));
    const caption = svgElement(doc, "title");
    caption.textContent = group.label;
    container.append(caption);
    const title = svgElement(doc, "text", {
      x: String(group.x + 14), y: String(group.y + 23),
      class: "nox-graph-v2-group-label",
    });
    title.textContent = clipped(group.label, 42);
    container.append(title);
    svg.append(container);
  }

  for (const edge of layout.edges) {
    const path = svgElement(doc, "path", {
      d: edge.path, class: "nox-flow-edge nox-graph-v2-edge",
      "marker-end": `url(#${markerId})`,
    });
    const title = svgElement(doc, "title");
    title.textContent = edge.from + " → " + edge.to + (edge.label ? " — " + edge.label : "");
    path.append(title);
    svg.append(path);
    if (edge.label && edge.labelX !== undefined && edge.labelY !== undefined) {
      const display = clipped(edge.label, 28);
      const width = Math.min(218, Math.max(36, display.length * 6.8 + 14));
      svg.append(svgElement(doc, "rect", {
        x: String(edge.labelX - width / 2), y: String(edge.labelY - 21),
        width: String(width), height: "19", rx: "6",
        class: "nox-graph-v2-edge-label-bg",
      }));
      const caption = text(doc, svg, display, edge.labelX, edge.labelY - 7,
        "nox-graph-v2-edge-label");
      const full = svgElement(doc, "title");
      full.textContent = edge.label;
      caption.append(full);
    }
  }

  for (const node of layout.nodes) {
    const group = svgElement(doc, "g", {
      class: "nox-flow-node nox-graph-v2-node",
      "data-kind": node.kind ?? "default",
    });
    group.append(svgElement(doc, "rect", {
      x: String(node.x), y: String(node.y),
      width: String(node.width), height: String(node.height), rx: "11",
    }));
    const full = svgElement(doc, "title");
    full.textContent = node.label;
    group.append(full);
    // Compact bounded labels: original full text is preserved in title/details.
    const words = node.label.split(/\s+/);
    const lines: string[] = [];
    for (const word of words) {
      const index = lines.length - 1;
      if (index >= 0 && (lines[index] + " " + word).length <= 27) lines[index] += " " + word;
      else lines.push(word);
    }
    const visible = lines.length > 2
      ? [clipped(lines[0], 29), clipped(lines.slice(1).join(" "), 29)]
      : lines.map(line => clipped(line, 29));
    for (const [index, line] of visible.entries()) {
      text(doc, group, line, node.x + node.width / 2,
        node.y + node.height / 2 + (index - (visible.length - 1) / 2) * 15 + 4,
        "nox-graph-v2-node-text");
    }
    svg.append(group);
  }
  return svg;
}

/**
 * Async output shell; restores original source on validation / layout failure.
 * Never gives the model-produced spec authority over the host DOM or vault.
 */
export function renderNoxFlowV2(spec: NoxFlowSpecV2, source: string,
                                doc: Document): HTMLElement {
  const root = doc.createElement("section");
  root.className = "nox-visual nox-rich-flow nox-graph-v2";
  root.setAttribute("aria-label", spec.title ?? "Read-only graph diagram");
  const title = doc.createElement("strong");
  title.className = "nox-rich-title";
  title.textContent = spec.title ?? "Graph diagram";
  root.append(title);
  const status = doc.createElement("p");
  status.className = "nox-graph-v2-status";
  status.setAttribute("role", "status");
  status.textContent = "Arranging diagram…";
  root.append(status);

  const showSource = (): void => {
    root.replaceChildren(title);
    const warning = doc.createElement("p");
    warning.className = "nox-visual-warning";
    warning.textContent = "Advanced graph layout unavailable; original source preserved.";
    const pre = doc.createElement("pre");
    const code = doc.createElement("code");
    code.textContent = source;
    pre.append(code);
    root.append(warning, pre);
  };
  void layoutNoxFlowV2(spec).then(layout => {
    if (!root.isConnected) return;
    const svg = drawGraph(doc, spec, layout);
    status.remove();
    mountNoxGraphViewport({
      root, graphic: svg, naturalWidth: layout.width, kind: "flow",
      label: "Advanced graph; use zoom, fit, pan or expand",
    });
    const details = doc.createElement("details");
    details.className = "nox-rich-flow-details";
    const summary = doc.createElement("summary");
    summary.textContent = "View nodes and connections";
    details.append(summary);
    const list = doc.createElement("ol");
    const labels = new Map(spec.nodes.map(node => [node.id, node.label]));
    for (const edge of spec.edges) {
      const line = doc.createElement("li");
      line.textContent = (labels.get(edge.from) ?? edge.from) + " → " +
        (labels.get(edge.to) ?? edge.to) +
        (edge.label ? " — " + edge.label : "");
      list.append(line);
    }
    details.append(list);
    root.append(details);
  }).catch(() => {
    if (root.isConnected) showSource();
  });
  return root;
}
