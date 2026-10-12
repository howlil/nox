/** Storage failures are distinct from provider/structured-response failures. */
export class PersistenceError extends Error {
  readonly diagnostic: string;

  constructor(operation: string, cause: unknown) {
    super(operation);
    this.name = "PersistenceError";
    this.diagnostic = cause instanceof Error ? cause.message : String(cause);
  }
}
