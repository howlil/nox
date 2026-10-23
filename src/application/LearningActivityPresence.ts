/**
 * Coordinates observed host activity with the one authoritative program writer.
 * This is only an ephemeral desired/acknowledged projection, not a second
 * persistence store. The program orchestrator owns every durable transition.
 */
export class LearningActivityPresence {
  private lastInteractionAt: number;
  private desiredIdle = false;
  private confirmedIdle = false;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly setIdle: (idle: boolean) => Promise<void>,
    private readonly now: () => number = Date.now,
    private readonly thresholdMs = 180_000,
  ) {
    this.lastInteractionAt = this.now();
  }

  /** Interaction supersedes an uncommitted idle request. */
  observeInteraction(): Promise<void> {
    this.lastInteractionAt = this.now();
    this.desiredIdle = false;
    return this.reconcile();
  }

  /** Rechecks even after failure; never mark persistence successful early. */
  checkIdle(): Promise<void> {
    this.desiredIdle = this.now() - this.lastInteractionAt >= this.thresholdMs;
    return this.reconcile();
  }

  private reconcile(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight.then(() =>
        this.confirmedIdle === this.desiredIdle ? undefined : this.reconcile());
    }
    const operation = (async () => {
      // One program mutation at a time. If interaction arrives while an idle
      // CAS update is in flight, publish the latest observation afterward.
      while (this.confirmedIdle !== this.desiredIdle) {
        const target = this.desiredIdle;
        await this.setIdle(target);
        this.confirmedIdle = target;
      }
    })();
    this.inFlight = operation;
    return operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
  }
}
