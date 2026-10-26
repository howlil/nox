import { App, TFile } from "obsidian";
import { PersistenceError, LearningStateWriteConflict, DEFAULT_LEARNING_STATE, decodeLearningState, type LearningState } from "@nox/core";
export { LearningStateWriteConflict } from "@nox/core";

const ROOT = "00-learning-os";
const PROGRESS_PATH = `${ROOT}/progress.json`;

function cloneDefaultState(): LearningState {
  return { ...DEFAULT_LEARNING_STATE, gaps: [], evidence: [] };
}

/**
 * One durable evidence ledger per vault. All read-modify-write operations are
 * serialized inside the instance and use Obsidian's atomic Vault.process to
 * reject concurrent external writes. The transcript owns committed outcomes.
 */
export class VaultLearningStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly snapshots = new WeakMap<LearningState, string | null>();

  constructor(private readonly app: App) {}

  async load(): Promise<LearningState> {
    await this.tail;
    const file = this.app.vault.getFileByPath(PROGRESS_PATH);
    if (!file || !(file instanceof TFile)) {
      const state = cloneDefaultState();
      this.snapshots.set(state, null);
      return state;
    }

    // cachedRead can return a pre-write buffer during a vault-sync race;
    // freshness is necessary for the CAS token and for recovery correctness.
    const raw = await this.app.vault.read(file);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error(`Learning state is invalid JSON: ${PROGRESS_PATH}`); }
    let state: LearningState;
    try { state = decodeLearningState(parsed); }
    catch { throw new Error(`Learning state has an unsupported shape: ${PROGRESS_PATH}`); }
    this.snapshots.set(state, raw);
    return state;
  }

  async save(state: LearningState, expected?: LearningState): Promise<void> {
    const snapshot = expected ? this.snapshots.get(expected) : undefined;
    if (expected && snapshot === undefined) throw new LearningStateWriteConflict();
    const operation = this.tail.then(async () => {
      // Refuse malformed states rather than making the next restart unbootable.
      const validated = decodeLearningState(state);
      await this.ensureRoot();
      const content = JSON.stringify(validated, null, 2) + "\n";
      const file = this.app.vault.getFileByPath(PROGRESS_PATH);
      try {
        if (file && file instanceof TFile) {
          // Migration is non-destructive and the backup is verified before the
          // only canonical progress file is replaced.
          if (validated.version === 3) {
            const previous = await this.app.vault.read(file);
            if (expected && previous !== snapshot) throw new LearningStateWriteConflict();
            let priorVersion: unknown;
            try { priorVersion = (JSON.parse(previous) as { version?: unknown }).version; }
            catch { throw new PersistenceError("Cannot back up invalid learning state JSON", "Malformed migration source"); }
            if (priorVersion === 1 || priorVersion === 2) {
              const backupPath = `${ROOT}/progress.v${priorVersion}-${crypto.randomUUID()}.backup.json`;
              const backup = await this.app.vault.create(backupPath, previous);
              if (await this.app.vault.read(backup) !== previous) {
                throw new PersistenceError("Unable to verify progress migration backup", "Backup bytes differ from original");
              }
            }
          }
          if (expected) {
            await this.app.vault.process(file, current => {
              if (current !== snapshot) throw new LearningStateWriteConflict();
              return content;
            });
          } else {
            await this.app.vault.modify(file, content);
          }
        } else {
          if (expected && snapshot !== null) throw new LearningStateWriteConflict();
          await this.app.vault.create(PROGRESS_PATH, content);
        }
      } catch (error) {
        if (error instanceof LearningStateWriteConflict || error instanceof PersistenceError) throw error;
        throw new PersistenceError("Unable to persist learning progress", error);
      }
    });
    // Keep the queue healthy after a failed write: the caller still receives it.
    this.tail = operation.catch(() => {});
    return operation;
  }

  private async ensureRoot(): Promise<void> {
    if (!this.app.vault.getAbstractFileByPath(ROOT)) {
      await this.app.vault.createFolder(ROOT);
    }
  }
}
