import { App, TFile } from "obsidian";
import type { LearningProgram, ProgramCollection } from "../domain/learning-program/types";
import { validateConstraints, validateCurriculum } from "../domain/learning-program/rules";
import { isValidSessionTiming } from "../domain/learning-program/session-time";
import { validateObjectiveFocus } from "../domain/learning-program/focus-transitions";
import { PersistenceError } from "./PersistenceError";
import { decodeProgramCollection, prepareProgramCollectionWrite } from "./program-schema";

const PATH = "00-learning-os/programs.json";
const BACKUPS = "00-learning-os/backups";
const EMPTY: ProgramCollection = { version: 2, programs: [] };

export class ProgramWriteConflict extends Error {
  constructor() {
    super("Program write conflict: programs.json changed since the authoritative read; reload before retrying.");
    this.name = "ProgramWriteConflict";
  }
}
function validActivityDays(days: Record<string, number>): boolean {
  return Object.entries(days).every(([day, ms]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(ms) && ms >= 0);
}

/** One durable collection per vault; writes are serialized and validated before I/O. */
export class VaultProgramStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly snapshots = new WeakMap<ProgramCollection, string | null>();
  private lastKnownBytes: string | null = null;
  constructor(private readonly app: App) {}
  async load(): Promise<ProgramCollection> {
    // Avoid reading a partially written local snapshot during an in-flight save.
    await this.tail;
    const file = this.app.vault.getFileByPath(PATH);
    if (!file || !(file instanceof TFile)) {
      this.lastKnownBytes = null;
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
    const state = decodeProgramCollection(data);
    for (const program of state.programs) this.validateProgram(program);
    const snapshot = structuredClone(state);
    this.lastKnownBytes = text;
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
    validateCurriculum({ kind: "curriculum", objectives: program.objectives }, program.constraints);
    if (program.focus) validateObjectiveFocus(program, program.focus);
    if (program.deferredNotes !== undefined) {
      if (!Array.isArray(program.deferredNotes) || program.deferredNotes.length > 100) {
        throw new Error("Invalid deferred learning notes.");
      }
      const ids = new Set<string>();
      for (const note of program.deferredNotes) {
        if (!note || typeof note.id !== "string" || !note.id.trim() ||
            note.id.length > 150 || ids.has(note.id) ||
            typeof note.focusSessionId !== "string" || !note.focusSessionId.trim() ||
            typeof note.objectiveId !== "string" ||
            !program.objectives.some(item => item.id === note.objectiveId) ||
            !Number.isFinite(note.createdAt) || note.createdAt < 0 ||
            typeof note.text !== "string" || note.text.trim().length < 3 ||
            note.text.length > 500) throw new Error("Invalid deferred learning note.");
        ids.add(note.id);
      }
    }
    const operationIds = new Set<string>();
    let priorVersion = 1;
    const revisions = program.curriculumRevisions ?? [];
    for (const [index, revision] of revisions.entries()) {
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
      } else if (["revise", "change-prerequisites", "deprecate", "rollback"].includes(revision.kind)) {
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
        if (revision.kind === "rollback") {
          const previous = revisions[index - 1];
          if (!previous || previous.operationId !== revision.revertedOperationId ||
              !previous.before || !previous.after ||
              JSON.stringify(previous.after) !== JSON.stringify(revision.before) ||
              JSON.stringify(previous.before) !== JSON.stringify(revision.after)) {
            throw new Error("Rollback must reverse the immediately preceding approved structural revision.");
          }
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
  /** Back up exact v1 bytes before the first v2 rewrite. Never overwrite a backup. */
  private async backUpV1(bytes: string): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(BACKUPS)) {
      await this.app.vault.createFolder(BACKUPS);
    }
    const path = `${BACKUPS}/programs-v1-${crypto.randomUUID()}.json`;
    if (this.app.vault.getFileByPath(path)) throw new Error("Program backup path collision.");
    const backup = await this.app.vault.create(path, bytes);
    if (!(backup instanceof TFile) || await this.app.vault.read(backup) !== bytes) {
      throw new Error("Program backup verification failed; migration aborted.");
    }
  }

  async save(next: ProgramCollection): Promise<void> {
    // Bind expected bytes at call time. Another load/save must not silently
    // rebase this operation onto a newer snapshot while it waits in the queue.
    const expected = this.snapshots.has(next)
      ? this.snapshots.get(next)! : this.lastKnownBytes;
    const operation = this.tail.then(async () => {
      // Read-old/write-new: migrating does not fabricate evidence or rubric provenance.
      const nextV2 = prepareProgramCollectionWrite(next);
      for (const program of nextV2.programs) this.validateProgram(program);
      try {
        if (!this.app.vault.getAbstractFileByPath("00-learning-os")) {
          await this.app.vault.createFolder("00-learning-os");
        }
        const content = JSON.stringify(nextV2, null, 2) + "\n";
        const file = this.app.vault.getFileByPath(PATH);
        if (file && file instanceof TFile) {
          if (expected === null) throw new ProgramWriteConflict();
          // Verify freshness before saving the exact historical bytes. A concurrent
          // external modification is checked again by the atomic process callback.
          if (decodeProgramCollection(JSON.parse(expected)).version === 1) {
            if (await this.app.vault.read(file) !== expected) throw new ProgramWriteConflict();
            await this.backUpV1(expected);
          }
          await this.app.vault.process(file, current => {
            if (current !== expected) throw new ProgramWriteConflict();
            return content;
          });
        } else {
          if (expected !== null) throw new ProgramWriteConflict();
          await this.app.vault.create(PATH, content);
        }
        this.lastKnownBytes = content;
        this.snapshots.set(next, content);
      } catch (error) {
        if (error instanceof ProgramWriteConflict) throw error;
        throw new PersistenceError("Unable to save learning program", error);
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
