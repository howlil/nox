import type { LearningProgram } from "../../../domain/learning-program/types";
import type { LearningState } from "../../../domain/learning-state/types";
import { deriveLearnerProfile } from "../../../domain/learner-model/learner-profile";
import { startObjectiveFocus, transitionObjectiveFocus } from "../../../domain/learning-program/focus-transitions";

/** Pure focus authorization/transition policy. The caller owns serialized CAS. */
export function beginObjectiveFocus(
  program: LearningProgram, state: LearningState,
  objectiveId: string, chatSessionId: string, now: number, focusId: string,
): LearningProgram {
  const objective = program.objectives.find(item => item.id === objectiveId);
  if (!objective) throw new Error("Unknown learning objective.");
  const profile = deriveLearnerProfile(program, state, now);
  const statuses = new Map(profile.objectives.map(item => [item.objectiveId, item.status]));
  if (!objective.prerequisiteIds.every(id => statuses.get(id) === "mastered")) {
    throw new Error("Prerequisites are not mastered for this objective.");
  }
  return startObjectiveFocus(program, objectiveId, chatSessionId, now, focusId);
}

export function changeObjectiveFocus(
  program: LearningProgram, action: "pause" | "resume" | "end", now: number,
  chatSessionId?: string,
): LearningProgram {
  if (action === "resume" && program.focus?.chatSessionId !== chatSessionId) {
    throw new Error("Return to the original chat to resume the pending focus challenge.");
  }
  return transitionObjectiveFocus(program, action, now);
}
