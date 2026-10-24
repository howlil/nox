/** Storage failures are distinct from provider/structured-response failures. */
export class PersistenceError extends Error {
  readonly diagnostic: string;

  constructor(operation: string, cause: unknown) {
    super(operation);
    this.name = "PersistenceError";
    this.diagnostic = cause instanceof Error ? cause.message : String(cause);
  }
}

/** Another host committed a newer session document. Reload before retrying. */
export class SessionWriteConflict extends Error {
  constructor() {
    super("Conversation changed in another tab or host. Reload before retrying.");
    this.name = "SessionWriteConflict";
  }
}

/** Optimistic authoritative snapshot conflict, safe to retry after a fresh load. */
export class LearningStateWriteConflict extends Error {
  constructor() {
    super("Learning progress changed since it was loaded. Reload and retry evidence projection.");
    this.name = "LearningStateWriteConflict";
  }
}
