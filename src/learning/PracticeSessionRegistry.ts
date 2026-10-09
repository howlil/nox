import { PracticeStateMachine } from "./PracticeStateMachine";

/**
 * Owns the in-process association between a conversation session and its
 * transient practice lifecycle.
 *
 * Practice state deliberately does not persist across plugin restarts.
 */
export class PracticeSessionRegistry {
  private readonly machines = new Map<string, PracticeStateMachine>();

  forSession(sessionId: string): PracticeStateMachine {
    let machine = this.machines.get(sessionId);

    if (!machine) {
      machine = new PracticeStateMachine();
      this.machines.set(sessionId, machine);
    }

    return machine;
  }

  hasWaitingQuestion(sessionId: string): boolean {
    return this.machines.get(sessionId)?.isWaitingForAnswer() ?? false;
  }

  reset(sessionId: string): void {
    this.machines.delete(sessionId);
  }

  clear(): void {
    this.machines.clear();
  }
}
