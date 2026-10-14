/** Opaque-origin preview sizing. One host listener; never expose vault APIs to frames. */
interface PreviewRegistration {
  frame: HTMLIFrameElement;
  id: string;
  height: number;
  lastUpdate: number;
}
const frames = new WeakMap<object, PreviewRegistration>();
let listening = false;
const MIN_HEIGHT = 120;
export const MAX_PREVIEW_HEIGHT = 12000;

export function normalizePreviewHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      value < 0 || value > 1_000_000) return null;
  return Math.max(MIN_HEIGHT, Math.min(MAX_PREVIEW_HEIGHT, Math.ceil(value) + 2));
}

function handlePreviewResize(event: MessageEvent): void {
  if (event.origin !== "null" || !event.source ||
      typeof event.data !== "object" || event.data === null) return;
  const entry = frames.get(event.source);
  if (!entry || !entry.frame.isConnected ||
      event.data.kind !== "nox-preview-resize" ||
      event.data.id !== entry.id) return;
  const height = normalizePreviewHeight(event.data.height);
  if (height === null || Math.abs(height - entry.height) < 4) return;
  // Drop pathological model-controlled resize loops (30 updates per second).
  const now = performance.now();
  if (now - entry.lastUpdate < 33) return;
  entry.lastUpdate = now;
  entry.height = height;
  entry.frame.style.height = height + "px";
}

/** Mount only AFTER the frame enters the DOM so contentWindow exists. */
export function bindResponsivePreview(frame: HTMLIFrameElement, id: string): () => void {
  if (!listening) {
    window.addEventListener("message", handlePreviewResize);
    listening = true;
  }
  const source = frame.contentWindow;
  if (source) frames.set(source, {
    frame, id, height: 240, lastUpdate: -Infinity,
  });
  return () => {
    if (source) frames.delete(source);
  };
}
