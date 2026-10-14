/**
 * Small, DOM-free gesture policy for the native Obsidian history list.
 * Horizontal drags must dominate vertical page scrolling before taking control.
 */
export type SwipeAxis = "horizontal" | "vertical" | "undecided";
export type SwipeSide = "leading" | "trailing";

export const HISTORY_SWIPE_LEADING = 72;
export const HISTORY_SWIPE_TRAILING = 144;

export function swipeAxis(dx: number, dy: number, slop = 9): SwipeAxis {
  if (Math.hypot(dx, dy) < slop) return "undecided";
  if (Math.abs(dx) > Math.abs(dy) * 1.3) return "horizontal";
  if (Math.abs(dy) > Math.abs(dx)) return "vertical";
  return "undecided";
}

/** Resistance beyond the revealed action width, never exposing row overflow. */
export function swipeOffset(delta: number, initial = 0): number {
  const raw = initial + delta;
  const limit = raw >= 0 ? HISTORY_SWIPE_LEADING : HISTORY_SWIPE_TRAILING;
  const absolute = Math.abs(raw);
  if (absolute <= limit) return raw;
  return Math.sign(raw) * (limit + (absolute - limit) * 0.18);
}

export function swipeRelease(offset: number, velocityX: number, rowWidth: number): {
  side: SwipeSide | null;
  full: boolean;
  offset: number;
} {
  const projected = offset + Math.max(-550, Math.min(550, velocityX)) * 0.12;
  const side: SwipeSide | null = projected > 35 ? "leading"
    : projected < -62 ? "trailing" : null;
  const fullThreshold = Math.max(
    (offset >= 0 ? HISTORY_SWIPE_LEADING : HISTORY_SWIPE_TRAILING) + 48,
    Math.max(0, rowWidth) * 0.56,
  );
  const full = side !== null && Math.abs(offset) >= fullThreshold;
  return {
    side,
    full,
    offset: side === "leading" ? HISTORY_SWIPE_LEADING
      : side === "trailing" ? -HISTORY_SWIPE_TRAILING : 0,
  };
}
