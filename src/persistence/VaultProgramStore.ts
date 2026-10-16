import { App, TFile } from "obsidian";
import type { LearningProgram, ProgramCollection } from "../domain/learning-program/types";
import { validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { isValidSessionTiming } from "../domain/learning-program/session-time";
import { validateObjectiveFocus } from "../domain/learning-program/focus-transitions";
import { PersistenceError } from "./PersistenceError";

const PATH = "00-learning-os/programs.json";
const EMPTY: ProgramCollection = { version: 1, programs: [] };
function validActivityDays(days: Record<string, number>): boolean {
  return Object.entries(days).every(([day, ms]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms) && ms >= 0);
}

/** One durable collection per vault; writes are serialized and validated before I/O. */
export class VaultProgramStore {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly app: App) {}
  async load(): Promise<ProgramCollection> {
    // Avoid reading a partially written local snapshot during an in-flight save.
    await this.tail;
    const file = this.app.vault.getFileByPath(PATH);
    if (!file || !(file instanceof TFile)) return structuredClone(EMPTY);
    // A program read may be followed by a mutation; do not trust a stale cache.
    const text = await this.app.vault.read(file);
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      throw new Error(`Invalid NOX programs JSON at ${PATH}. Back up the file and restore valid JSON before using learning programs.`);
    }
    if (!data || typeof data !== "object") throw new Error("Invalid NOX program collection.");
    const state = data as ProgramCollection;
    if (state.version !== 1 || !Array.isArray(state.programs) ||
        (state.activeProgramId && !state.programs.some(p => p.id === state.activeProgramId))) {
      throw new Error("Unsupported NOX program collection.");
    }
    for (const program of state.programs) this.validateProgram(program);
    return structuredClone(state);
  }
  private validateProgram(program: LearningProgram) {
    if (program.version !== 1 || !program.id || !program.goal?.trim() ||
        !Number.isInteger(program.planVersion) || program.planVersion < 1) {
      throw new Error("Invalid learning program.");
    }
    if (program.workspaceApproved !== undefined && typeof program.workspaceApproved !== "boolean") {
      throw new Error("Invalid workspace approval metadata.");
    }
    validateConstraints(program.constraints, new Date(program.createdAt));
    validateCurriculum({ kind: "curriculum", objectives: program.objectives }, program.constraints);
    if (program.focus) validateObjectiveFocus(program, program.focus);
    const operationIds = new Set<string>();
    let priorVersion = 1;
    for (const revision of program.curriculumRevisions ?? []) {
      if (!revision.operationId || operationIds.has(revision.operationId) ||
          !Number.isInteger(revision.fromVersion) || !Number.isInteger(revision.toVersion) ||
          revision.fromVersion !== priorVersion ||
          revision.toVersion !== revision.fromVersion + 1 ||
          revision.toVersion > program.planVersion ||
          !Array.isArray(revision.reasonEvidenceIds)) {
        throw new Error("Invalid curriculum revision history.");
      }
      operationIds.add(revision.operationId);
      priorVersion = revision.toVersion;
      if (revision.kind === "prerequisite-remediation") {
        if (revision.reasonEvidenceIds.length < 2 ||
            !program.objectives.some(item => item.id === revision.addedObjectiveId)) {
          throw new Error("Invalid curriculum remediation history.");
        }
      } else if (["revise", "change-prerequisites", "deprecate"].includes(revision.kind)) {
        if (revision.reasonEvidenceIds.length !== 0 ||
            !revision.rationale || revision.rationale.trim().length < 8 ||
            !revision.targetObjectiveId ||
            !revision.before || !revision.after ||
            revision.before.id !== revision.targetObjectiveId ||
            revision.after.id !== revision.targetObjectiveId ||
            !program.objectives.some(item => item.id === revision.targetObjectiveId) ||
            revision.before.sourceRefs.join("\\0") !== revision.after.sourceRefs.join("\\0")) {
          throw new Error("Invalid approved structural revision history.");
        }
      } else {
        throw new Error("Unsupported curriculum revision kind.");
      }
    }
    if (operationIds.size > 0 && priorVersion !== program.planVersion) {
      throw new Error("Curriculum revision lineage does not match plan version.");
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
  async save(next: ProgramCollection): Promise<void> {
    const operation = this.tail.then(async () => {
      if (next.version !== 1 || next.programs.length > 100 ||
          (next.activeProgramId && !next.programs.some(p => p.id === next.activeProgramId))) {
        throw new Error("Invalid program collection.");
      }
      for (const program of next.programs) this.validateProgram(program);
      try {
        if (!this.app.vault.getAbstractFileByPath("00-learning-os")) {
          await this.app.vault.createFolder("00-learning-os");
        }
        const content = JSON.stringify(next, null, 2) + "\n";
        const file = this.app.vault.getFileByPath(PATH);
        if (file && file instanceof TFile) await this.app.vault.modify(file, content);
        else await this.app.vault.create(PATH, content);
      } catch (error) { throw new PersistenceError("Unable to save learning program", error); }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
