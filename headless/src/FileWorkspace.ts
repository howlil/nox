import { open, readFile, mkdir, lstat, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { SessionDataPort } from "../../src/types";
import type { LearningStatePort } from "../../src/application/ports";
import { DEFAULT_LEARNING_STATE, type LearningState } from "../../src/domain/learning-state/types";
import { LearningStateWriteConflict } from "../../src/domain/persistence/errors";
import { decodeLearningState } from "../../src/persistence/learning-state-schema";

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

  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly snapshots = new WeakMap<LearningState, string | null>();

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

  private async readBytes(name: "sessions.json" | "progress.json"): Promise<string | null> {
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

  private async writeJson(name: "sessions.json" | "progress.json", value: unknown): Promise<void> {
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
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.tail;
    await this.lock.close();
    await unlink(join(this.root, ".nox-headless.lock"));
  }
}
