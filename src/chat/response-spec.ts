/** Presentation-only visual formats. Never grants model output vault or plugin authority. */
export type NoxVisualKind = "html-preview" | "svg-preview" | "js-preview" | "nox-chart" | "nox-flow" | "nox-card";

export interface NoxChartSpec {
  type: "bar" | "line" | "horizontal-bar";
  title?: string;
  labels: string[];
  values: number[];
}

/** Plain HTML fences stay code. Execution requires the explicit preview language. */
export function visualKindFromClasses(classes: readonly string[]): NoxVisualKind | null {
  for (const name of classes) {
    const language = name.startsWith("language-") ? name.slice(9) : "";
    if (language === "html-preview" || language === "svg-preview" || language === "js-preview" ||
        language === "nox-chart" || language === "nox-flow" || language === "nox-card") return language;
  }
  return null;
}

export const MAX_VISUAL_SOURCE_CHARS = 80_000;
const MAX_CHART_POINTS = 16;

export function parseNoxChart(raw: string): NoxChartSpec | null {
  if (raw.length > MAX_VISUAL_SOURCE_CHARS) return null;
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return null; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  if (obj.type !== "bar" && obj.type !== "line" && obj.type !== "horizontal-bar") return null;
  if (obj.title !== undefined && (typeof obj.title !== "string" || obj.title.length > 120)) return null;
  if (!Array.isArray(obj.labels) || !Array.isArray(obj.values) ||
      obj.labels.length < 1 || obj.labels.length > MAX_CHART_POINTS ||
      obj.labels.length !== obj.values.length) return null;
  if (!obj.labels.every(x => typeof x === "string" && x.trim().length > 0 && x.length <= 80)) return null;
  if (!obj.values.every(x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1e9)) return null;
  return { type: obj.type, title: obj.title as string | undefined,
    labels: obj.labels as string[], values: obj.values as number[] };
}

export interface NoxFlowSpec {
  version: 1;
  title?: string;
  direction: "TB";
  layout: "vertical-stack" | "layered";
  nodes: Array<{ id: string; label: string; kind?: "default" | "decision" | "focus" | "result" }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export interface NoxCardSpec {
  version: 1;
  kind: "metrics" | "comparison" | "status-table";
  title: string;
  description?: string;
  items: Array<{
    label: string;
    value: string | number;
    unit?: string;
    detail?: string;
    status?: "success" | "pending" | "warning" | "error";
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseBoundedJSON(raw: string): Record<string, unknown> | null {
  if (!raw.trim() || raw.length > MAX_VISUAL_SOURCE_CHARS) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch { return null; }
}

const flowKinds = ["default", "decision", "focus", "result"];
export function parseNoxFlow(raw: string): NoxFlowSpec | null {
  const obj = parseBoundedJSON(raw);
  if (!obj || obj.version !== 1 || obj.direction !== "TB" ||
    (obj.layout !== "vertical-stack" && obj.layout !== "layered") ||
    (obj.title !== undefined && (typeof obj.title !== "string" || obj.title.length > 120)) ||
    !Array.isArray(obj.nodes) || !Array.isArray(obj.edges) ||
    obj.nodes.length < 1 || obj.nodes.length > 24 || obj.edges.length > 48) return null;
  const nodes: NoxFlowSpec["nodes"] = [];
  const ids = new Set<string>();
  for (const candidate of obj.nodes) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(candidate.id) || ids.has(candidate.id) ||
      typeof candidate.label !== "string" || !candidate.label.trim() ||
      candidate.label.length > 100 ||
      (candidate.kind !== undefined && !flowKinds.includes(String(candidate.kind)))) return null;
    ids.add(candidate.id);
    nodes.push({ id: candidate.id, label: candidate.label,
      ...(candidate.kind ? { kind: candidate.kind as NoxFlowSpec["nodes"][number]["kind"] } : {}) });
  }
  const edges: NoxFlowSpec["edges"] = [];
  const duplicates = new Set<string>();
  for (const candidate of obj.edges) {
    if (!isRecord(candidate) || typeof candidate.from !== "string" ||
      typeof candidate.to !== "string" || !ids.has(candidate.from) || !ids.has(candidate.to) ||
      candidate.from === candidate.to ||
      (candidate.label !== undefined && (typeof candidate.label !== "string" || candidate.label.length > 64))) return null;
    const key = candidate.from + "\\0" + candidate.to;
    if (duplicates.has(key)) return null;
    duplicates.add(key);
    edges.push({ from: candidate.from, to: candidate.to,
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}) });
  }
  const children = new Map(nodes.map(node => [node.id, [] as string[]]));
  for (const edge of edges) children.get(edge.from)!.push(edge.to);
  const visited = new Set<string>(), active = new Set<string>();
  const walk = (id: string): boolean => {
    if (active.has(id)) return false;
    if (visited.has(id)) return true;
    active.add(id);
    for (const next of children.get(id) ?? []) if (!walk(next)) return false;
    active.delete(id);
    visited.add(id);
    return true;
  };
  if (!nodes.every(node => walk(node.id))) return null;
  return { version: 1, title: obj.title as string | undefined, direction: "TB",
    layout: obj.layout, nodes, edges };
}

export function parseNoxCard(raw: string): NoxCardSpec | null {
  const obj = parseBoundedJSON(raw);
  if (!obj || obj.version !== 1 ||
    (obj.kind !== "metrics" && obj.kind !== "comparison" && obj.kind !== "status-table") ||
    typeof obj.title !== "string" || !obj.title.trim() || obj.title.length > 120 ||
    (obj.description !== undefined &&
      (typeof obj.description !== "string" || obj.description.length > 240)) ||
    !Array.isArray(obj.items) || obj.items.length < 1 || obj.items.length > 12) return null;
  const items: NoxCardSpec["items"] = [];
  for (const item of obj.items) {
    if (!isRecord(item) || typeof item.label !== "string" || !item.label.trim() ||
      item.label.length > 90 ||
      !((typeof item.value === "string" && item.value.length <= 120) ||
        (typeof item.value === "number" && Number.isFinite(item.value) &&
          Math.abs(item.value) <= 1e12)) ||
      (item.unit !== undefined && (typeof item.unit !== "string" || item.unit.length > 32)) ||
      (item.detail !== undefined && (typeof item.detail !== "string" || item.detail.length > 200)) ||
      (item.status !== undefined && !["success", "pending", "warning", "error"].includes(String(item.status)))) {
      return null;
    }
    items.push({
      label: item.label, value: item.value,
      ...(typeof item.unit === "string" ? { unit: item.unit } : {}),
      ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
      ...(typeof item.status === "string" ? { status: item.status as NoxCardSpec["items"][number]["status"] } : {}),
    });
  }
  return { version: 1, kind: obj.kind, title: obj.title,
    description: obj.description as string | undefined, items };
}

/**
 * The iframe must be created with sandbox="allow-scripts" ONLY for HTML,
 * without allow-same-origin, top-navigation, forms or popups.
 * CSP blocks network, remote code, forms, nested frames and external assets.
 * No model-controlled attributes or values are interpolated into host DOM.
 */
export function createNoxPreviewDocument(
  kind: "html-preview" | "svg-preview" | "js-preview", source: string,
  frameId?: string,
): string | null {
  if (!source.trim() || source.length > MAX_VISUAL_SOURCE_CHARS) return null;
  const script = kind === "svg-preview" ? "'none'" : "'unsafe-inline'";
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "img-src data:",
    "font-src data:",
    "style-src 'unsafe-inline'",
    "script-src " + script,
  ].join("; ");
  // The frame owns height measurement. Host only accepts bounded size messages
  // from this exact opaque-origin contentWindow with a per-instance identifier.
  const autoHeight = kind !== "svg-preview" && frameId && /^[a-z0-9-]{1,80}$/i.test(frameId)
    ? "<script>" + [
      "(function(){",
      "const frameId=" + JSON.stringify(frameId) + ";",
      "let pending=false;",
      "function report(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;",
      "const body=document.body;",
      "const height=Math.max(body?.scrollHeight||0,body?.offsetHeight||0);",
      "parent.postMessage({kind:'nox-preview-resize',id:frameId,height},'*');",
      "});}",
      "const observer=new ResizeObserver(report);",
      "observer.observe(document.documentElement);",
      "if(document.body)observer.observe(document.body);",
      "else document.addEventListener('DOMContentLoaded',()=>{observer.observe(document.body);report()},{once:true});",
      "window.addEventListener('load',report);window.addEventListener('resize',report);",
      "report();",
      "})();",
    ].join("") + "</script>" : "";
  // JavaScript has no access to the host: it runs only after an explicit click
  // in an opaque-origin iframe with network and parent access denied.
  const safeJs = source.replace(new RegExp("</script", "gi"), "<\\/script");
  const jsBody = '<pre id="nox-output" style="white-space:pre-wrap;overflow-wrap:anywhere;' +
    'font:13px/1.6 ui-monospace,monospace;margin:14px"></pre>' +
    '<script>' +
    'const output=document.getElementById("nox-output");' +
    'const print=(...args)=>{output.textContent+=args.map(x=>' +
    'typeof x==="string"?x:JSON.stringify(x)).join(" ")+"\\n"};' +
    'console.log=print;console.info=print;console.warn=print;console.error=print;' +
    'addEventListener("error",e=>print(e.message));' +
    'addEventListener("unhandledrejection",e=>print(String(e.reason)));' +
    '</script><script>' + safeJs + '</script>';
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
    '<meta name="referrer" content="no-referrer">' +
    '<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;' +
    'font:14px/1.5 system-ui;overflow-wrap:anywhere;padding:12px}img,svg{max-width:100%;height:auto}' +
    '</style>' + autoHeight + '</head><body>' + (kind === "js-preview" ? jsBody : source) +
    '</body></html>';
}
