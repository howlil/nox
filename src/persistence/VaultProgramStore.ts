import { App, TFile } from "obsidian";
import type { ProgramCollection } from "../domain/learning-program/types";
import { PersistenceError } from "./PersistenceError";
import { ProgramWriteConflict } from "../domain/persistence/errors";
import { decodeProgramCollection, validateProgram } from "../domain/learning-program/collection-schema";
export { ProgramWriteConflict } from "../domain/persistence/errors";

const PATH = "00-learning-os/programs.json";
const EMPTY: ProgramCollection = { version: 1, programs: [] };
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
    const snapshot = decodeProgramCollection(data);
    this.snapshots.set(snapshot, text);
    return snapshot;
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
      for (const program of prepared.programs) validateProgram(program);
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
          // Existing collections require an authoritative loaded CAS snapshot.
          // Never overwrite a live program document without concurrency protection.
          if (!expected) throw new ProgramWriteConflict();
          await this.app.vault.process(file, current => {
            if (current !== expectedBytes) throw new ProgramWriteConflict();
            return content;
          });
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
