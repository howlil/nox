/** Host-only, per-operation failure state. The domain and vault remain authoritative. */
export type BackgroundWriteKind = "checkpoint" | "idle" | "focus" | "rename" | "visibility";

const subjects: Record<BackgroundWriteKind, string> = {
  checkpoint: "learning time",
  idle: "idle state",
  focus: "note focus",
  rename: "renamed-note learning time",
  visibility: "inactive state",
};

export class BackgroundWriteFeedback {
  private readonly failedKinds = new Set<BackgroundWriteKind>();

  constructor(private readonly notify: (message: string) => void) {}

  failure(kind: BackgroundWriteKind, error: unknown): void {
    if (this.failedKinds.has(kind)) return;
    this.failedKinds.add(kind);
    console.warn("[Nox] Could not save " + subjects[kind], error);
    try {
      this.notify("Nox could not save " + subjects[kind] +
        ". Check vault storage. Background updates may retry while Nox is open.");
    } catch (notifyError) {
      // Failure reporting must not turn an observed background rejection into
      // an unhandled rejection when the Obsidian notice surface is unavailable.
      console.warn("[Nox] Background failure notice unavailable", notifyError);
    }
  }

  success(kind: BackgroundWriteKind): void {
    this.failedKinds.delete(kind);
  }

  async observe(kind: BackgroundWriteKind, operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
      this.success(kind);
    } catch (error) {
      this.failure(kind, error);
    }
  }
}
