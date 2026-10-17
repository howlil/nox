import { App, TFile } from "obsidian";
import type { LearningProgram, ProgramCollection } from "../domain/learning-program/types";
import { validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { isValidSessionTiming } from "../domain/learning-program/session-time";
import { PersistenceError } from "./PersistenceError";
import { validateObjectiveFocus } from "../domain/learning-program/focus-transitions";

export class ProgramWriteConflict extends Error {
  constructor() {
    super("Program write conflict: programs.json changed; reload the curriculum preview.");
    this.name = "ProgramWriteConflict";
  }
}

const PATH = "00-learning-os/programs.json";
const EMPTY: ProgramCollection = { version: 1, programs: [] };
function validActivityDays(days: Record<string, number>): boolean {
  return Object.entries(days).every(([day, ms]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms) && ms >= 0);
}

/** One durable collection per vault; writes are serialized and validated before I/O. */
export class VaultProgramStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly snapshots = new WeakMap<ProgramCollection, string | null>();
  constructor(private readonly app: App) {}
  async load(): Promise<ProgramCollection> {
    // Avoid reading a partially written local snapshot during an in-flight save.
    await this.tail;
    const file = this.app.vault.getFileByPath(PATH);
    if (!file || !(file instanceof TFile)) {
      const empty = structuredClone(EMPTY);
      this.snapshots.set(empty, null);
      return empty;
    }
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
    const snapshot = structuredClone(state);
    this.snapshots.set(snapshot, text);
    return snapshot;
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
  async save(next: ProgramCollection, expected?: ProgramCollection): Promise<void> {
    // The token is bound at API invocation, not after waiting in the async queue.
    const expectedBytes = expected ? this.snapshots.get(expected) : undefined;
    if (expected && expectedBytes === undefined) throw new ProgramWriteConflict();
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
          if (expected) {
            // Obsidian Vault.process atomically checks and replaces the current bytes.
            await this.app.vault.process(file, current => {
              if (current !== expectedBytes) throw new ProgramWriteConflict();
              return content;
            });
          } else {
            await this.app.vault.modify(file, content);
          }
        } else {
          if (expected && expectedBytes !== null) throw new ProgramWriteConflict();
          await this.app.vault.create(PATH, content);
        }
      } catch (error) {
        if (error instanceof ProgramWriteConflict) throw error;
        throw new PersistenceError("Unable to save learning program", error);
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
