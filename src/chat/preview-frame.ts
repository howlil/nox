/** Opaque-origin preview sizing. One listener per owning Obsidian window. */
interface PreviewRegistration {
  frame: HTMLIFrameElement;
  id: string;
  height: number;
  lastUpdate: number;
  pendingHeight: number | null;
  pendingTimer: number | null;
}
const frames = new WeakMap<object, PreviewRegistration>();
const listeners = new WeakMap<Window, number>();
const MIN_HEIGHT = 120;
export const MAX_PREVIEW_HEIGHT = 12000;

export function normalizePreviewHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) ||
      value < 0 || value > 1_000_000) return null;
  return Math.max(MIN_HEIGHT, Math.min(MAX_PREVIEW_HEIGHT, Math.ceil(value)));
}

function handlePreviewResize(event: MessageEvent): void {
  const payload: unknown = event.data;
  if (event.origin !== "null" || !event.source ||
      typeof payload !== "object" || payload === null || Array.isArray(payload)) return;
  const data = payload as Record<string, unknown>;
  const entry = frames.get(event.source);
  if (!entry || !entry.frame.isConnected ||
      data.kind !== "nox-preview-resize" || data.id !== entry.id) return;
  const height = normalizePreviewHeight(data.height);
  if (height === null || Math.abs(height - entry.height) < 4) return;
  // Keep the final measurement when multiple transitions complete within 33ms.
  // Dropping the trailing update leaves one-question previews at stale heights.
  const applyHeight = (next: number): void => {
    if (!entry.frame.isConnected) return;
    entry.lastUpdate = performance.now();
    entry.height = next;
    entry.frame.style.height = next + "px";
  };
  if (entry.pendingTimer !== null) {
    entry.pendingHeight = height;
    return;
  }
  const elapsed = performance.now() - entry.lastUpdate;
  if (elapsed < 33) {
    const win = entry.frame.ownerDocument.defaultView;
    if (!win) return;
    entry.pendingHeight = height;
    entry.pendingTimer = win.setTimeout(() => {
      entry.pendingTimer = null;
      const pending = entry.pendingHeight;
      entry.pendingHeight = null;
      if (pending !== null && Math.abs(pending - entry.height) >= 4) applyHeight(pending);
    }, Math.ceil(33 - elapsed));
    return;
  }
  applyHeight(height);
}

/** Mount only AFTER the frame enters the DOM so contentWindow exists. */
export function bindResponsivePreview(frame: HTMLIFrameElement, id: string): () => void {
  const ownerWindow = frame.ownerDocument.defaultView;
  const source = frame.contentWindow;
  if (!ownerWindow || !source) return () => {};

  const count = listeners.get(ownerWindow) ?? 0;
  if (count === 0) ownerWindow.addEventListener("message", handlePreviewResize);
  listeners.set(ownerWindow, count + 1);
  frames.set(source, { frame, id, height: 240, lastUpdate: -Infinity,
    pendingHeight: null, pendingTimer: null });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = frames.get(source);
    if (entry?.pendingTimer !== null && entry?.pendingTimer !== undefined) {
      ownerWindow.clearTimeout(entry.pendingTimer);
    }
    frames.delete(source);
    const remaining = (listeners.get(ownerWindow) ?? 1) - 1;
    if (remaining <= 0) {
      ownerWindow.removeEventListener("message", handlePreviewResize);
      listeners.delete(ownerWindow);
    } else listeners.set(ownerWindow, remaining);
  };
}
