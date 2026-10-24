import {
  DEFAULT_LEARNING_STATE, LearningStateWriteConflict, decodeLearningState,
  type SessionDataPort, type LearningStatePort, type LearningState,
} from "@nox/core";

type StoredRecord = { key: "sessions" | "progress"; revision: number; data: unknown };
const STORE = "records";

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB migration blocked by another tab"));
  });
}

/** A genuine IndexedDB transaction is the mutation owner.
 * No awaited work occurs between IDB read and put: the transaction remains
 * active, and overlapping tabs cannot interleave its read-modify-write. */
function transact<T>(
  db: IDBDatabase, key: StoredRecord["key"],
  mode: IDBTransactionMode,
  operation: (record: StoredRecord | undefined, store: IDBObjectStore) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T;
    let completed = false;
    tx.oncomplete = () => { completed = true; resolve(result); };
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => {
      // onabort is authoritative; avoid rejecting before the transaction settles.
    };
    const request = store.get(key);
    request.onerror = () => tx.abort();
    request.onsuccess = () => {
      try {
        const record = request.result as StoredRecord | undefined;
        if (record && (!Number.isSafeInteger(record.revision) || record.revision < 1)) {
          throw new Error("Unsupported browser storage revision");
        }
        result = operation(record, store);
      } catch (error) {
        // Preserve the precise application error while aborting atomically.
        tx.onabort = () => reject(error);
        tx.abort();
      }
    };
    // Suppress unhandled rejection only when an aborted request raced oncomplete.
    void completed;
  });
}

function safeSessions(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid browser session state");
  }
  return structuredClone(value as Record<string, unknown>);
}

function recordState(value: unknown): LearningState {
  return decodeLearningState(value);
}

export class BrowserWorkspace {
  readonly sessionData: SessionDataPort = {
    read: async () => transact(this.db, "sessions", "readonly", record =>
      record ? safeSessions(record.data) : {}),
    update: async mutate => transact(this.db, "sessions", "readwrite", (record, store) => {
      const before = record ? safeSessions(record.data) : {};
      const next = safeSessions(mutate(before));
      store.put({ key: "sessions", revision: (record?.revision ?? 0) + 1,
        data: next } satisfies StoredRecord);
    }),
  };

  readonly learningState: LearningStatePort = {
    load: async () => transact(this.db, "progress", "readonly", record => {
      const state = record ? recordState(record.data) : structuredClone(DEFAULT_LEARNING_STATE);
      const result = structuredClone(state);
      this.snapshots.set(result, record?.revision ?? 0);
      return result;
    }),
    save: async (next, expected) => {
      const revision = expected ? this.snapshots.get(expected) : undefined;
      if (expected && revision === undefined) throw new LearningStateWriteConflict();
      const validated = recordState(next);
      await transact(this.db, "progress", "readwrite", (record, store) => {
        const current = record?.revision ?? 0;
        if (record) recordState(record.data); // malformed existing state: fail closed
        if (expected ? revision !== current : current !== 0) {
          throw new LearningStateWriteConflict();
        }
        store.put({ key: "progress", revision: current + 1,
          data: structuredClone(validated) } satisfies StoredRecord);
      });
    },
  };

  private readonly snapshots = new WeakMap<LearningState, number>();
  private constructor(private readonly db: IDBDatabase) {}

  static async open(name: string): Promise<BrowserWorkspace> {
    if (!name.trim() || name.length > 160) throw new Error("Invalid NOX browser database name");
    return new BrowserWorkspace(await openDatabase(name));
  }
  close(): void { this.db.close(); }
}
