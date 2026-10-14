import type { LearningSession, SessionPauseReason, SessionTiming } from "./types";

/** Longer unobserved gaps (sleep, suspended JS) are NOT inferred as study. */
export const MAX_OBSERVED_INTERVAL_MS = 120_000;
const REASONS: readonly SessionPauseReason[] = ["manual", "ai-running", "app-inactive", "recovery"];

export function newSessionTiming(now: number): SessionTiming {
  return { version: 2, activeMs: 0, aiWaitingMs: 0, pauseReasons: [], checkpointAt: now };
}

export function isValidSessionTiming(value: unknown): value is SessionTiming {
  if (!value || typeof value !== "object") return false;
  const t = value as SessionTiming;
  return t.version === 2 &&
    Number.isFinite(t.activeMs) && t.activeMs >= 0 &&
    Number.isFinite(t.aiWaitingMs) && t.aiWaitingMs >= 0 &&
    Number.isFinite(t.checkpointAt) && t.checkpointAt >= 0 &&
    Array.isArray(t.pauseReasons) &&
    new Set(t.pauseReasons).size === t.pauseReasons.length &&
    t.pauseReasons.every(reason => REASONS.includes(reason));
}

/** Pure, deterministic checkpoint; no Date.now, Obsidian, provider or persistence. */
export function checkpointTiming(timing: SessionTiming, now: number): SessionTiming {
  const delta = now - timing.checkpointAt;
  const observed = Number.isFinite(delta) && delta >= 0 &&
    delta <= MAX_OBSERVED_INTERVAL_MS ? delta : 0;
  return {
    ...timing,
    activeMs: timing.activeMs + (timing.pauseReasons.length === 0 ? observed : 0),
    aiWaitingMs: timing.aiWaitingMs + (timing.pauseReasons.includes("ai-running") ? observed : 0),
    checkpointAt: now,
  };
}

export function setTimingPause(
  timing: SessionTiming,
  reason: SessionPauseReason,
  paused: boolean,
  now: number,
): SessionTiming {
  const updated = checkpointTiming(timing, now);
  const reasons = new Set(updated.pauseReasons);
  if (paused) reasons.add(reason);
  else reasons.delete(reason);
  return { ...updated, pauseReasons: [...reasons] };
}

/** Legacy active sessions recover PAUSED; no old wall time is reclassified as learning. */
export function recoverTiming(session: LearningSession, now: number): SessionTiming {
  const previous = session.timing && isValidSessionTiming(session.timing)
    ? session.timing : newSessionTiming(now);
  return {
    ...previous,
    checkpointAt: now,
    pauseReasons: [...new Set([...previous.pauseReasons.filter(r => r !== "ai-running"), "recovery" as const])],
  };
}

export function projectedTiming(session: LearningSession, now: number): SessionTiming | null {
  return session.timing ? checkpointTiming(session.timing, now) : null;
}

export function sessionRemainingMs(session: LearningSession, now: number): number {
  const timing = projectedTiming(session, now);
  // For legacy sessions we intentionally do not treat wall-clock time as active study.
  const active = timing?.activeMs ?? 0;
  return Math.max(0, session.timeBudgetMinutes * 60_000 - active);
}

export function sessionTimeStatus(session: LearningSession, now: number):
  "active" | "waiting-ai" | "paused" | "recovered" | "exhausted" {
  if (sessionRemainingMs(session, now) === 0) return "exhausted";
  const reasons = session.timing?.pauseReasons ?? ["recovery"];
  if (reasons.includes("recovery")) return "recovered";
  if (reasons.includes("ai-running")) return "waiting-ai";
  return reasons.length ? "paused" : "active";
}
