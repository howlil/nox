/**
 * Serializes authority-changing program mutations against canonical learner
 * outcome commits within one running NOX plugin instance.
 * It cannot make independent Obsidian files an ACID transaction or coordinate
 * another process/device; transcript-first replay remains mandatory.
 */
export class LearningMutationGate {
  private tail: Promise<void> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
