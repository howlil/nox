import type { IconName } from "obsidian";
import { setNoxIcon } from "./primitives";

const MIN_ZOOM = 0.75;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

/** Pure sizing contract: zoom affects only the graphic, never the transcript. */
export function graphDisplayWidth(naturalWidth: number, viewportWidth: number, zoom = 1): number {
  const natural = Number.isFinite(naturalWidth) ? Math.max(160, Math.min(10_000, naturalWidth)) : 480;
  const available = Number.isFinite(viewportWidth) ? Math.max(160, viewportWidth - 16) : 480;
  const scale = Number.isFinite(zoom) ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) : 1;
  return Math.round(Math.min(natural, available) * scale);
}

interface GraphViewportOptions {
  root: HTMLElement;
  graphic: Element;
  naturalWidth: number;
  label: string;
  kind: "mermaid" | "flow";
}

/**
 * Single, read-only graph interaction surface for native Mermaid and nox-flow.
 * All elements belong to the owning Obsidian window (including pop-outs).
 */
export function mountNoxGraphViewport(options: GraphViewportOptions): HTMLElement {
  const { root, graphic, naturalWidth, label, kind } = options;
  const doc = root.ownerDocument;
  const toolbar = doc.createElement("div");
  toolbar.className = "nox-diagram-toolbar nox-graph-toolbar";
  const viewport = doc.createElement("div");
  viewport.className = "nox-graph-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("role", "region");
  viewport.setAttribute("aria-label", label);
  const canvas = doc.createElement("div");
  canvas.className = "nox-graph-canvas";
  canvas.append(graphic);
  viewport.append(canvas);

  const control = (name: string, icon: IconName): HTMLButtonElement => {
    const button = doc.createElement("button");
    button.className = "nox-visual-action";
    button.type = "button";
    button.setAttribute("aria-label", name);
    button.title = name;
    setNoxIcon(button, icon);
    return button;
  };
  const out = control("Zoom out", "minus");
  const fit = control("Fit diagram", "scan");
  const zoomIn = control("Zoom in", "plus");
  const expand = control("Expand diagram", "maximize-2");
  toolbar.append(out, fit, zoomIn, expand);
  root.append(toolbar, viewport);

  let zoom = 1;
  const measure = (): void => {
    if (kind === "mermaid" && !root.classList.contains("is-expanded")) {
      root.style.width = "min(100%, " + Math.ceil(naturalWidth + 16) + "px)";
    } else {
      root.style.removeProperty("width");
    }
    const available = viewport.clientWidth || root.clientWidth || Math.min(naturalWidth, 768);
    canvas.style.width = graphDisplayWidth(naturalWidth, available, zoom) + "px";
    out.disabled = zoom <= MIN_ZOOM;
    zoomIn.disabled = zoom >= MAX_ZOOM;
    fit.disabled = zoom === 1;
    viewport.classList.toggle("is-zoomed", zoom !== 1);
  };
  out.addEventListener("click", () => {
    zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
    measure();
  });
  zoomIn.addEventListener("click", () => {
    zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP);
    measure();
  });
  fit.addEventListener("click", () => {
    zoom = 1;
    measure();
    viewport.scrollTo(0, 0);
  });
  const collapse = (): void => {
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
      measure();
      expand.focus();
    }
  });
  root.addEventListener("keydown", event => {
    if (event.key === "Escape" && root.classList.contains("is-expanded")) {
      event.preventDefault();
      collapse();
    }
  });

  // Drag-to-pan is deliberately limited to overflowed mouse views.
  // Touch and trackpad scrolling keep their platform-native behavior.
  let drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;
  viewport.addEventListener("pointerdown", event => {
    if (event.pointerType !== "mouse" || event.button !== 0 ||
        (viewport.scrollWidth <= viewport.clientWidth && viewport.scrollHeight <= viewport.clientHeight)) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-panning");
    event.preventDefault();
  });
  viewport.addEventListener("pointermove", event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  });
  const stopPan = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    viewport.classList.remove("is-panning");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener("pointerup", stopPan);
  viewport.addEventListener("pointercancel", stopPan);
  viewport.addEventListener("lostpointercapture", () => {
    drag = null;
    viewport.classList.remove("is-panning");
  });

  const Observer = doc.defaultView?.ResizeObserver;
  if (Observer) {
    const resize = new Observer(() => {
      if (root.isConnected) measure();
      else resize.disconnect();
    });
    resize.observe(viewport);
  }
  measure();
  return viewport;
}
