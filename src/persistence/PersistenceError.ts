/** Storage failures are distinct from provider/structured-response failures. */
export class PersistenceError extends Error {
  readonly diagnostic: string;

  constructor(operation: string, cause: unknown) {
    super(operation);
    this.name = "PersistenceError";
    this.diagnostic = cause instanceof Error ? cause.message : String(cause);
  }
}

/** Optimistic vault snapshot conflict, safe to retry after a fresh load. */
export class LearningStateWriteConflict extends Error {
  constructor() {
    super("Learning progress changed since it was loaded. Reload and retry evidence projection.");
    this.name = "LearningStateWriteConflict";
  }
}
