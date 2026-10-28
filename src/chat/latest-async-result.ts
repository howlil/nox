/** Owns the freshness of an asynchronous result; no external cancellation required.
 * A stale completion (success or error) must never update the caller's view.
 */
export type LatestAsyncOutcome<T> =
  | { status: "current"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "stale" };

export class LatestAsyncResult {
  private generation = 0;

  invalidate(): void { ++this.generation; }

  async run<T>(operation: () => Promise<T>): Promise<LatestAsyncOutcome<T>> {
    const current = ++this.generation;
    try {
      const value = await operation();
      return current === this.generation ? { status: "current", value } : { status: "stale" };
    } catch (error) {
      return current === this.generation ? { status: "failed", error } : { status: "stale" };
    }
  }
}
