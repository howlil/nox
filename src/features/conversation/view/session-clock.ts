/** UI-only projection: never persisted and never used for CAS or learning evidence. */
export type SessionClockSnapshot = {
  budgetMs: number;
  activeMs: number;
  remainingMs: number;
  aiWaitingMs: number;
  status: "active" | "waiting-ai" | "paused" | "recovered" | "exhausted";
};

/** Interpolate an observed UI tick; long suspended gaps await authoritative reconciliation. */
export function projectSessionClock(
  snapshot: SessionClockSnapshot | null, syncedAt: number, now: number,
): SessionClockSnapshot | null {
  if (!snapshot) return null;
  const elapsed = now - syncedAt;
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 120_000) return snapshot;
  if (snapshot.status === "active") {
    const charge = Math.min(elapsed, snapshot.remainingMs);
    const remainingMs = Math.max(0, snapshot.remainingMs - charge);
    return { ...snapshot, activeMs: snapshot.activeMs + charge, remainingMs,
      status: remainingMs === 0 ? "exhausted" : "active" };
  }
  if (snapshot.status === "waiting-ai") return { ...snapshot, aiWaitingMs: snapshot.aiWaitingMs + elapsed };
  return snapshot;
}
