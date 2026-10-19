/**
 * Exactly one in-process program mutation lane shared across plan, focus and
 * session operations. The queue does not own persistence or create a writer.
 * Every caller retains its own authoritative ProgramStorePort CAS operation.
 */
export class ProgramMutationQueue {
  private tail: Promise<void> = Promise.resolve();
  private writing = false;

  get isWriting(): boolean { return this.writing; }

  async idle(): Promise<void> { await this.tail; }

  run<T>(transaction: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      this.writing = true;
      try { return await transaction(); }
      finally { this.writing = false; }
    });
    // A failed operation must not poison subsequent queued mutations.
    this.tail = operation.then(() => {}, () => {});
    return operation;
  }
}
