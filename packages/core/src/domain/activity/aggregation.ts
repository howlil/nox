import type { LearningProgram } from "../learning-program/types";
import { projectedTiming } from "../learning-program/session-time";

export interface ActivitySummary {
  focusMinutes: number;
  waitingMinutes: number;
  sessions: number;
  activeDays: number;
  days: Record<string, number>;
  materials: Array<{ path: string; minutes: number }>;
  objectives: Array<{ objectiveId: string; minutes: number }>;
}

/** Single read-only projection over canonical session history, no separate progress ledger. */
export function summarizeActivity(programs: LearningProgram[], now = Date.now()): ActivitySummary {
  const days: Record<string, number> = {}, materials = new Map<string, number>();
  const objectives = new Map<string, number>();
  let focusMs = 0, waitingMs = 0, sessions = 0;
  const mergeDays = (record?: Record<string, number>) => {
    for (const [date, ms] of Object.entries(record ?? {})) {
      days[date] = (days[date] ?? 0) + ms;
    }
  };
  const merge = (target: Map<string, number>, record?: Record<string, number>, factor = 1) => {
    for (const [id, amount] of Object.entries(record ?? {})) {
      target.set(id, (target.get(id) ?? 0) + amount * factor);
    }
  };
  for (const program of programs) {
    for (const entry of program.sessionHistory ?? []) {
      sessions++;
      focusMs += (entry.activeMinutes ?? 0) * 60_000;
      waitingMs += (entry.aiWaitingMinutes ?? 0) * 60_000;
      mergeDays(entry.dailyActiveMs);
      merge(materials, entry.materialActiveMinutes, 1);
      merge(objectives, entry.objectiveActiveMinutes, 1);
    }
    const active = program.session && projectedTiming(program.session, now);
    if (active) {
      focusMs += active.activeMs;
      waitingMs += active.aiWaitingMs;
      mergeDays(active.dailyActiveMs);
      merge(materials, active.materialActiveMs, 1 / 60_000);
      merge(objectives, active.objectiveActiveMs, 1 / 60_000);
    }
  }
  return {
    focusMinutes: focusMs / 60_000, waitingMinutes: waitingMs / 60_000,
    sessions, activeDays: Object.values(days).filter(ms => ms > 0).length,
    days, materials: [...materials].map(([path, minutes]) => ({ path, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
    objectives: [...objectives].map(([objectiveId, minutes]) => ({ objectiveId, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}
