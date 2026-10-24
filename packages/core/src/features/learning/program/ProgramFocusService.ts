import type { LearningProgram } from "../../../domain/learning-program/types";
import { transitionObjectiveFocus } from "../../../domain/learning-program/focus-transitions";

/** Keep the existing feature entry point without owning a second domain rule. */
export { startEligibleObjectiveFocus as beginObjectiveFocus } from "../../../domain/learning-program/focus-transitions";

export function changeObjectiveFocus(
  program: LearningProgram, action: "pause" | "resume" | "end", now: number,
  chatSessionId?: string,
): LearningProgram {
  if (action === "resume" && program.focus?.chatSessionId !== chatSessionId) {
    throw new Error("Return to the original chat to resume the pending focus challenge.");
  }
  return transitionObjectiveFocus(program, action, now);
}
