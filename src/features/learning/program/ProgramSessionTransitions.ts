import type { LearningProgram, SessionPauseReason } from "../../../domain/learning-program/types";
import {
  checkpointTiming, focusSessionObjective, focusSessionMaterial, newSessionTiming,
  projectedTiming, recoverTiming, setTimingPause,
} from "../../../domain/learning-program/session-time";

/** One program session transition at a time, invoked inside the shared CAS queue. */
export function startTimedSession(program: LearningProgram, now: number): LearningProgram {
  if (program.session) throw new Error("A study session is already active. Use /end-session before starting another.");
  return { ...program, session: { startedAt: now,
    timeBudgetMinutes: program.constraints.minutesPerSession, timing: newSessionTiming(now) } };
}

export function extendTimedSession(program: LearningProgram, minutes: number): LearningProgram {
  if (!program.session) throw new Error("Start a session before extending its timebox.");
  if (!Number.isInteger(minutes) || minutes < 5 || program.session.timeBudgetMinutes + minutes > 240) {
    throw new Error("Extension must be at least 5 minutes; total timebox must not exceed 240.");
  }
  return { ...program, session: { ...program.session, timeBudgetMinutes: program.session.timeBudgetMinutes + minutes } };
}

export function endTimedSession(program: LearningProgram, now: number): LearningProgram {
  if (!program.session) throw new Error("No active session to end.");
  const { startedAt } = program.session;
  const minutesSpent = Math.max(0, (now - startedAt) / 60_000);
  const finalTiming = projectedTiming(program.session, now);
  return { ...program, session: undefined, sessionHistory: [
    ...(program.sessionHistory ?? []), {
      startedAt, endedAt: now, minutesSpent,
      ...(finalTiming ? {
        activeMinutes: finalTiming.activeMs / 60_000,
        aiWaitingMinutes: finalTiming.aiWaitingMs / 60_000,
        ...(finalTiming.dailyActiveMs ? { dailyActiveMs: finalTiming.dailyActiveMs } : {}),
        ...(finalTiming.materialActiveMs ? {
          materialActiveMinutes: Object.fromEntries(Object.entries(finalTiming.materialActiveMs)
            .map(([path, ms]) => [path, ms / 60_000])),
        } : {}),
        ...(finalTiming.objectiveActiveMs ? {
          objectiveActiveMinutes: Object.fromEntries(Object.entries(finalTiming.objectiveActiveMs)
            .map(([id, ms]) => [id, ms / 60_000])),
        } : {}),
      } : {}),
    },
  ] };
}

export function pauseTimedSession(
  program: LearningProgram, reason: SessionPauseReason, paused: boolean, now: number,
): LearningProgram {
  if (!program.session) throw new Error("No active learning session.");
  const previous = program.session.timing ?? recoverTiming(program.session, now);
  return { ...program, session: { ...program.session,
    timing: setTimingPause(previous, reason, paused, now) } };
}

export function resumeTimedSession(program: LearningProgram, now: number): LearningProgram {
  if (!program.session) throw new Error("No active learning session.");
  let timing = program.session.timing ?? recoverTiming(program.session, now);
  timing = setTimingPause(timing, "manual", false, now);
  timing = setTimingPause(timing, "recovery", false, now);
  return { ...program, session: { ...program.session, timing } };
}

export function focusTimedObjective(program: LearningProgram, objectiveId: string, now: number): LearningProgram {
  if (!program.session) throw new Error("Start a session before studying an objective.");
  if (!program.objectives.some(o => o.id === objectiveId)) throw new Error("Unknown objective.");
  const timing = program.session.timing ?? recoverTiming(program.session, now);
  return { ...program, session: { ...program.session,
    timing: focusSessionObjective(timing, objectiveId, now) } };
}

export function focusTimedMaterial(program: LearningProgram, path: string, now: number): LearningProgram {
  if (!program.session?.timing) return program;
  return { ...program, session: { ...program.session,
    timing: focusSessionMaterial(program.session.timing, path, now) } };
}

export function checkpointTimedSession(program: LearningProgram, now: number): LearningProgram {
  if (!program.session?.timing) return program;
  return { ...program, session: { ...program.session,
    timing: checkpointTiming(program.session.timing, now) } };
}

export function recoverProgramSessions(program: LearningProgram, now: number): LearningProgram {
  return {
    ...program,
    ...(program.focus?.status === "active" ?
      { focus: { ...program.focus, status: "paused" as const, pausedAt: now } } : {}),
    ...(program.session ? { session: { ...program.session, timing: recoverTiming(program.session, now) } } : {}),
  };
}
