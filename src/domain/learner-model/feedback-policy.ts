import type { LearningObjective } from "../learning-program/types";
import type { LearningEvidence } from "../learning-state/types";

export type FeedbackDecision =
  | { kind: "repair"; failedCriteria: string[]; evidenceIds: string[] }
  | { kind: "scaffold"; level: 1 | 2 | 3 | 4; failedCriteria: string[]; evidenceIds: string[] }
  | { kind: "independent-check"; failedCriteria: string[]; evidenceIds: string[] }
  | { kind: "delayed-recall"; failedCriteria: string[]; evidenceIds: string[] };

/** Domain-only guidance, never a mastery verdict or a second practice state machine. */
export function decideFeedback(
  objective: LearningObjective,
  attempts: readonly LearningEvidence[],
  latest: LearningEvidence,
): FeedbackDecision {
  const failedCriteria = objective.rubric.filter(criterion =>
    latest.rubricResults?.some(result => result.criterion === criterion && !result.met));
  const priorFailures = attempts.filter(item => item.id !== latest.id &&
    item.outcome !== "correct" && item.rubricResults?.some(result =>
      !result.met && failedCriteria.includes(result.criterion))).length;
  if (latest.outcome === "incorrect" || latest.outcome === "partial") {
    if (failedCriteria.length > 0 && priorFailures >= 1) {
      // The first repeat receives a limited scaffold; higher levels require
      // explicit policy and hint UX so help cannot silently escalate.
      return { kind: "scaffold", level: 2, failedCriteria,
        evidenceIds: attempts.filter(item => item.outcome !== "correct").slice(-2).map(item => item.id) };
    }
    return { kind: "repair", failedCriteria, evidenceIds: [latest.id] };
  }
  if (latest.assisted || latest.assessmentCoverage === "single-item" ||
      !objective.rubric.every(criterion =>
        latest.rubricResults?.some(result => result.criterion === criterion && result.met))) {
    return { kind: "independent-check", failedCriteria, evidenceIds: [latest.id] };
  }
  return { kind: "delayed-recall", failedCriteria: [], evidenceIds: [latest.id] };
}
