import { App, TFile } from "obsidian";
import type { LearningProgram, ProgramCollection } from "../domain/learning-program/types";
import { validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { isValidSessionTiming } from "../domain/learning-program/session-time";
import { PersistenceError } from "./PersistenceError";

const PATH = "00-learning-os/programs.json";
const EMPTY: ProgramCollection = { version: 1, programs: [] };

/** One durable collection per vault; writes are serialized and validated before I/O. */
export class VaultProgramStore {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly app: App) {}
  async load(): Promise<ProgramCollection> {
    const file = this.app.vault.getFileByPath(PATH);
    if (!file || !(file instanceof TFile)) return structuredClone(EMPTY);
    const text = await this.app.vault.cachedRead(file);
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error("Invalid NOX programs JSON."); }
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
    validateConstraints(program.constraints, new Date(program.createdAt));
    validateCurriculum({ kind: "curriculum", objectives: program.objectives }, program.constraints);
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
    for (const entry of program.sessionHistory ?? []) {
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
