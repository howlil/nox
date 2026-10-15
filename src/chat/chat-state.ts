import type { LearningActionKind } from "../application/learning-types";
import { parseProgramCommand } from "../domain/learning-program/commands";
import { parseScopeCommand } from "../domain/practice/learning-scope";

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

/** Local learning operations must remain usable when a model is offline. */
export function isLocallyExecutableCommand(input: string): boolean {
  const prompt = input.trim();
  if (prompt.toLowerCase() === "/hint" || parseScopeCommand(prompt)) return true;
  try {
    const command = parseProgramCommand(prompt);
    return Boolean(command && command.kind !== "plan" &&
      command.kind !== "next" && command.kind !== "free-practice");
  } catch {
    return false;
  }
}
