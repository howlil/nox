import { App, TFile } from "obsidian";
import type { LearningProgram, ProgramCollection } from "../domain/learning-program/types";
import { validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { isValidSessionTiming } from "../domain/learning-program/session-time";
import { PersistenceError } from "./PersistenceError";
import { validateObjectiveFocus } from "../domain/learning-program/focus-transitions";

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
    if ((state.version !== 1 && state.version !== 2) || !Array.isArray(state.programs) ||
        (state.activeProgramId && !state.programs.some(p => p.id === state.activeProgramId))) {
      throw new Error("Unsupported NOX program collection.");
    }
    if (state.programs.some(p => p.version !== state.version)) {
      throw new Error("Mixed learning program schema versions.");
    }
    for (const program of state.programs) this.validateProgram(program);
    if (state.programs.filter(p => p.focus?.status === "active").length > 1) {
      throw new Error("Multiple active objective focuses are not allowed.");
    }
    return structuredClone(state);
  }
  private validateProgram(program: LearningProgram) {
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
      if ((next.version !== 1 && next.version !== 2) || next.programs.length > 100 ||
          (next.activeProgramId && !next.programs.some(p => p.id === next.activeProgramId))) {
        throw new Error("Invalid program collection.");
      }
      // Upgrade only when enabling focus; legacy timed collections otherwise retain v1.
      const upgrade = next.version === 2 || next.programs.some(p => Boolean(p.focus));
      const prepared: ProgramCollection = upgrade
        ? { ...next, version: 2, programs: next.programs.map(p => ({ ...p, version: 2 as const })) }
        : next;
      if (prepared.programs.filter(p => p.focus?.status === "active").length > 1) {
        throw new Error("Multiple active objective focuses are not allowed.");
      }
      for (const program of prepared.programs) this.validateProgram(program);
      try {
        if (!this.app.vault.getAbstractFileByPath("00-learning-os")) {
          await this.app.vault.createFolder("00-learning-os");
        }
        const content = JSON.stringify(prepared, null, 2) + "\n";
        const file = this.app.vault.getFileByPath(PATH);
        if (file && file instanceof TFile) {
          if (upgrade) {
            const previous = await this.app.vault.read(file);
            if ((JSON.parse(previous) as ProgramCollection).version === 1) {
              // Read-old/write-new only after a verified, non-destructive v1 snapshot.
              const backupPath = "00-learning-os/programs.v1-" + crypto.randomUUID() + ".backup.json";
              const backup = await this.app.vault.create(backupPath, previous);
              if (await this.app.vault.read(backup) !== previous) {
                throw new Error("Could not verify legacy program backup.");
              }
            }
          }
          await this.app.vault.modify(file, content);
        } else await this.app.vault.create(PATH, content);
      } catch (error) { throw new PersistenceError("Unable to save learning program", error); }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
