import { open, readFile, mkdir, lstat, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { SessionDataPort } from "../../src/types";
import type { LearningStatePort, ProgramStorePort } from "../../src/application/ports";
import type { ProgramCollection } from "../../src/domain/learning-program/types";
import { decodeProgramCollection } from "../../src/domain/learning-program/collection-schema";
import { ProgramWriteConflict } from "../../src/domain/persistence/errors";
import { DEFAULT_LEARNING_STATE, type LearningState } from "../../src/domain/learning-state/types";
import { LearningStateWriteConflict } from "../../src/domain/persistence/errors";
import { decodeLearningState } from "../../src/persistence/learning-state-schema";

/** Atomic rename occurred, but syncing the parent directory failed.
 * New bytes may be observable even though power-loss durability is unknown.
 * Callers must reload the authoritative state before retrying. */
export class WorkspaceDurabilityUncertain extends Error {
  constructor(readonly filename: string, readonly cause: unknown) {
    super("Commit durability uncertain for " + filename + ". Reload authoritative state before retrying.");
    this.name = "WorkspaceDurabilityUncertain";
  }
}

/**
 * Local single-process authority for the M2 headless host.
 * Refuses a second process and refuses stale lock removal automatically.
 * JSON writes use fsync -> same-directory atomic rename. This does NOT
 * implement multi-machine sync or transactional cross-file commits.
 */
export class FileWorkspace {
  readonly sessionData: SessionDataPort = {
    read: async () => {
      await this.tail;
      return (await this.readJson("sessions.json")) ?? {};
    },
    update: (mutate) => this.enqueue(async () => {
      const existing = (await this.readJson("sessions.json")) ?? {};
      const next = mutate(structuredClone(existing));
      if (!next || typeof next !== "object" || Array.isArray(next)) {
        throw new Error("Session transaction must return a JSON object.");
      }
      await this.writeJson("sessions.json", next);
    }),
  };

  readonly learningState: LearningStatePort = {
    load: async () => {
      await this.tail;
      const raw = await this.readBytes("progress.json");
      const value = raw === null ? structuredClone(DEFAULT_LEARNING_STATE) :
        decodeLearningState(JSON.parse(raw));
      const snapshot = structuredClone(value);
      this.snapshots.set(snapshot, raw);
      return snapshot;
    },
    save: (state, expected) => {
      // Resolve expected snapshot at invocation, before queueing the write.
      const token = expected ? this.snapshots.get(expected) : undefined;
      if (expected && token === undefined) return Promise.reject(new LearningStateWriteConflict());
      return this.enqueue(async () => {
        const current = await this.readBytes("progress.json");
        // No caller may overwrite existing evidence without a loaded CAS snapshot.
        if (current !== null && !expected) throw new LearningStateWriteConflict();
        if (expected && current !== token) throw new LearningStateWriteConflict();
        // Existing malformed state must never be overwritten as a fresh state.
        if (current !== null) decodeLearningState(JSON.parse(current));
        const decoded = decodeLearningState(state);
        await this.writeJson("progress.json", decoded);
      });
    },
  };

  /** All program writes share the workspace I/O lane and guard against stale snapshots. */
  readonly programs: ProgramStorePort = {
    load: async () => {
      await this.tail;
      const raw = await this.readBytes("programs.json");
      const value: ProgramCollection = raw === null
        ? { version: 1, programs: [] }
        : decodeProgramCollection(JSON.parse(raw));
      const snapshot = structuredClone(value);
      this.programSnapshots.set(snapshot, raw);
      return snapshot;
    },
    save: (next, expected) => {
      // Resolve the CAS token synchronously, before entering the queued operation.
      const token = expected ? this.programSnapshots.get(expected) : undefined;
      if (expected && token === undefined) return Promise.reject(new ProgramWriteConflict());
      return this.enqueue(async () => {
        const current = await this.readBytes("programs.json");
        if (current !== null && !expected) throw new ProgramWriteConflict();
        if (expected && current !== token) throw new ProgramWriteConflict();
        if (current !== null) decodeProgramCollection(JSON.parse(current));
        // Match Obsidian's legacy v1->v2 upgrade when starting an objective focus.
        const upgrade = next.version === 2 || next.programs.some(program => Boolean(program.focus));
        const prepared: ProgramCollection = upgrade
          ? { ...next, version: 2, programs: next.programs.map(program => ({
              ...program, version: 2 as const,
            })) }
          : next;
        const validated = decodeProgramCollection(prepared);
        await this.writeJson("programs.json", validated);
      });
    },
  };

  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly snapshots = new WeakMap<LearningState, string | null>();
  private readonly programSnapshots = new WeakMap<ProgramCollection, string | null>();

  private constructor(
    private readonly root: string,
    private readonly lock: FileHandle,
  ) {}

  static async open(directory: string): Promise<FileWorkspace> {
    const root = resolve(directory);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Headless workspace must be a real directory, not a symlink.");
    }
    const lockPath = join(root, ".nox-headless.lock");
    let lock: FileHandle;
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error("Workspace already locked; a previous crash may require manual lock recovery.");
      }
      throw error;
    }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }) + "\n");
      await lock.sync();
      return new FileWorkspace(root, lock);
    } catch (error) {
      await lock.close();
      await unlink(lockPath).catch(() => {});
      throw error;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Headless workspace is closed."));
    const task = this.tail.then(operation);
    this.tail = task.then(() => undefined, () => undefined);
    return task;
  }

  private async readBytes(name: "sessions.json" | "progress.json" | "programs.json"): Promise<string | null> {
    const file = join(this.root, name);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe workspace state file: " + name);
      return await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async readJson(name: "sessions.json"): Promise<Record<string, unknown> | null> {
    const raw = await this.readBytes(name);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid workspace session JSON.");
    }
    return structuredClone(parsed as Record<string, unknown>);
  }

  private async writeJson(name: "sessions.json" | "progress.json" | "programs.json", value: unknown): Promise<void> {
    const target = join(this.root, name);
    // Fail closed on symlinks rather than replacing external files.
    await this.readBytes(name);
    const tmp = join(this.root, "." + name + "." + randomUUID() + ".tmp");
    const handle = await open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(tmp).catch(() => {});
      throw error;
    }
    await handle.close();
    try {
      await rename(tmp, target);
    } catch (error) {
      await unlink(tmp).catch(() => {});
      throw error;
    }
    // Do not conflate failure after an observable commit with a failed rename.
    try { await this.syncParentDirectory(); }
    catch (error) { throw new WorkspaceDurabilityUncertain(name, error); }
  }

  private async syncParentDirectory(): Promise<void> {
    // Windows does not consistently support directory FileHandle sync. It
    // retains atomic rename plus file fsync, without a full metadata guarantee.
    if (process.platform === "win32") return;
    const directory = await open(this.root, "r");
    try { await directory.sync(); }
    finally { await directory.close(); }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.tail;
    await this.lock.close();
    await unlink(join(this.root, ".nox-headless.lock"));
  }
}
