/** Presentation-only visual formats. Never grants model output vault or plugin authority. */
export type NoxVisualKind = "html-preview" | "svg-preview" | "nox-chart";

export interface NoxChartSpec {
  type: "bar" | "line";
  title?: string;
  labels: string[];
  values: number[];
}

/** Plain HTML fences stay code. Execution requires the explicit preview language. */
export function visualKindFromClasses(classes: readonly string[]): NoxVisualKind | null {
  for (const name of classes) {
    const language = name.startsWith("language-") ? name.slice(9) : "";
    if (language === "html-preview" || language === "svg-preview" ||
        language === "nox-chart") return language;
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
  if (obj.type !== "bar" && obj.type !== "line") return null;
  if (obj.title !== undefined && (typeof obj.title !== "string" || obj.title.length > 120)) return null;
  if (!Array.isArray(obj.labels) || !Array.isArray(obj.values) ||
      obj.labels.length < 1 || obj.labels.length > MAX_CHART_POINTS ||
      obj.labels.length !== obj.values.length) return null;
  if (!obj.labels.every(x => typeof x === "string" && x.trim().length > 0 && x.length <= 80)) return null;
  if (!obj.values.every(x => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1e9)) return null;
  return { type: obj.type, title: obj.title as string | undefined,
    labels: obj.labels as string[], values: obj.values as number[] };
}

/**
 * The iframe must be created with sandbox="allow-scripts" ONLY for HTML,
 * without allow-same-origin, top-navigation, forms or popups.
 * CSP blocks network, remote code, forms, nested frames and external assets.
 * No model-controlled attributes or values are interpolated into host DOM.
 */
export function createNoxPreviewDocument(
  kind: "html-preview" | "svg-preview", source: string,
): string | null {
  if (!source.trim() || source.length > MAX_VISUAL_SOURCE_CHARS) return null;
  const script = kind === "html-preview" ? "'unsafe-inline'" : "'none'";
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
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
    '<meta name="referrer" content="no-referrer">' +
    '</head><body>' + source + '</body></html>';
}
