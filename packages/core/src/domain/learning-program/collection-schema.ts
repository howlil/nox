import type { LearningProgram, ProgramCollection } from "./types";
import { validateConstraints, validateCurriculum } from "./rules";
import { isValidSessionTiming } from "./session-time";
import { validateObjectiveFocus } from "./focus-transitions";

/** Shared persisted program validation for Obsidian and portable hosts.
 * Never treat malformed state as an empty workspace. */
function validActivityDays(days: Record<string, number>): boolean {
  return Object.entries(days).every(([day, ms]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms) && ms >= 0);
}

export function validateProgram(program: LearningProgram): void {
    if ((program.version !== 1 && program.version !== 2) || !program.id || !program.goal?.trim() ||
        !Number.isInteger(program.planVersion) || program.planVersion < 1) {
      throw new Error("Invalid learning program.");
    }
    if (program.workspaceApproved !== undefined && typeof program.workspaceApproved !== "boolean") {
      throw new Error("Invalid workspace approval metadata.");
    }
    validateConstraints(program.constraints, new Date(program.createdAt));
    if (program.focus) validateObjectiveFocus(program, program.focus);
    validateCurriculum({ kind: "curriculum", objectives: program.objectives }, program.constraints);
    if (program.objectives.some(o => o.objectiveRevision !== undefined && o.objectiveRevision > program.planVersion)) {
      throw new Error("Objective revision is newer than the containing curriculum.");
    }
    const revisions = program.curriculumRevisions ?? [];
    const operationIds = new Set<string>();
    let previousVersion = 0;
    for (const revision of revisions) {
      if (!revision.operationId || operationIds.has(revision.operationId) ||
          revision.programId !== program.id ||
          !Number.isInteger(revision.baseVersion) ||
          !Number.isInteger(revision.toVersion) ||
          revision.toVersion !== revision.baseVersion + 1 ||
          revision.baseVersion < previousVersion ||
          revision.toVersion > program.planVersion ||
          !Number.isFinite(revision.appliedAt) || revision.appliedAt < 0) {
        throw new Error("Invalid curriculum revision history.");
      }
      operationIds.add(revision.operationId);
      previousVersion = revision.toVersion;
    }
    if (revisions.length && previousVersion !== program.planVersion) {
      throw new Error("Curriculum version does not match persisted revision history.");
    }
    if (program.session) {
      const { startedAt, timeBudgetMinutes, timing } = program.session;
      if (!Number.isFinite(startedAt) || startedAt < 0 ||
          !Number.isInteger(timeBudgetMinutes) || timeBudgetMinutes < 10 ||
          timeBudgetMinutes > 240 ||
          (timing !== undefined && (!isValidSessionTiming(timing) || timing.checkpointAt < startedAt ||
            (timing.focusObjectiveId !== undefined && !program.objectives.some(o => o.id === timing.focusObjectiveId)) ||
            Object.keys(timing.objectiveActiveMs ?? {}).some(id => !program.objectives.some(o => o.id === id))))) {
        throw new Error("Invalid program session.");
      }
    }
    if (program.session?.timing?.dailyActiveMs &&
        !validActivityDays(program.session.timing.dailyActiveMs)) throw new Error("Invalid session daily activity.");
    for (const entry of program.sessionHistory ?? []) {
      if (entry.dailyActiveMs && !validActivityDays(entry.dailyActiveMs)) throw new Error("Invalid daily activity.");
      if (entry.materialActiveMinutes && (Object.values(entry.materialActiveMinutes).some(
        n => !Number.isFinite(n) || n < 0))) throw new Error("Invalid material study time.");
      if (!Number.isFinite(entry.startedAt) || !Number.isFinite(entry.endedAt) ||
          entry.endedAt < entry.startedAt || !Number.isFinite(entry.minutesSpent) ||
          entry.minutesSpent < 0 ||
          (entry.activeMinutes !== undefined && (!Number.isFinite(entry.activeMinutes) || entry.activeMinutes < 0)) ||
          (entry.aiWaitingMinutes !== undefined && (!Number.isFinite(entry.aiWaitingMinutes) || entry.aiWaitingMinutes < 0)) ||
          (entry.objectiveActiveMinutes !== undefined && (typeof entry.objectiveActiveMinutes !== "object" ||
            Object.entries(entry.objectiveActiveMinutes).some(([id, minutes]) =>
              !program.objectives.some(o => o.id === id) || !Number.isFinite(minutes) || minutes < 0)))) {
        throw new Error("Invalid program session history.");
      }
    }
}

export function decodeProgramCollection(data: unknown): ProgramCollection {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid NOX program collection.");
  }
  const state = data as ProgramCollection;
  if ((state.version !== 1 && state.version !== 2) || !Array.isArray(state.programs) ||
      state.programs.length > 100 ||
      (state.activeProgramId && !state.programs.some(p => p.id === state.activeProgramId))) {
    throw new Error("Unsupported NOX program collection.");
  }
  if (state.programs.some(p => p.version !== state.version)) {
    throw new Error("Mixed learning program schema versions.");
  }
  for (const program of state.programs) validateProgram(program);
  if (state.programs.filter(p => p.focus?.status === "active").length > 1) {
    throw new Error("Multiple active objective focuses are not allowed.");
  }
  return structuredClone(state);
}
