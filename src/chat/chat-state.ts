import type { LearningActionKind } from "../application/learning-types";

export type TerminalOutcome = "completed" | "stopped" | "failed";

export interface InspectableContextState {
  hasSelection: boolean;
  hasActiveNote: boolean;
  explicitCount: number;
  systemCount: number;
}

export function hasInspectableContext(
  state: InspectableContextState,
): boolean {
  return (
    state.hasSelection ||
    state.hasActiveNote ||
    state.explicitCount > 0 ||
    state.systemCount > 0
  );
}

export function shouldResetAction(
  action: LearningActionKind,
  outcome: TerminalOutcome,
  hasNextPracticeQuestion = false,
): boolean {
  if (action === "practice") {
    return outcome === "completed" && !hasNextPracticeQuestion;
  }

  return (
    action === "explain" ||
    action === "review" ||
    action === "edit"
  );
}

/** Backwards-compatible pure selector for existing view helper consumers. */
export { isLocallyExecutableCommand } from "../application/local-command";
