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
  options: { scaffoldAfterFailures?: number } = {},
): FeedbackDecision {
  const threshold = options.scaffoldAfterFailures ?? 2;
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > 5) {
    throw new Error("Invalid scaffold threshold.");
  }
  const matched = (item: LearningEvidence, criterion: string, index: number, met: boolean) =>
    item.rubricResults?.some(result => result.met === met &&
      (item.objectiveRevision !== undefined ?
        Boolean(objective.criteria?.[index]?.id &&
          result.criterionId === objective.criteria[index].id) :
        result.criterion === criterion));
  const failedCriteria = objective.rubric.filter((criterion, index) =>
    matched(latest, criterion, index, false));
  const priorFailures = attempts.filter(item => item.id !== latest.id &&
    item.outcome !== "correct" && failedCriteria.some(criterion =>
      matched(item, criterion, objective.rubric.indexOf(criterion), false))).length;
  if (latest.outcome === "incorrect" || latest.outcome === "partial") {
    if (failedCriteria.length > 0 && priorFailures + 1 >= threshold) {
      // The first repeat receives a limited scaffold; higher levels require
      // explicit policy and hint UX so help cannot silently escalate.
      return { kind: "scaffold", level: 2, failedCriteria,
        evidenceIds: attempts.filter(item => item.outcome !== "correct").slice(-2).map(item => item.id) };
    }
    return { kind: "repair", failedCriteria, evidenceIds: [latest.id] };
  }
  if (latest.assisted || latest.assessmentCoverage === "single-item" ||
      !objective.rubric.every(criterion =>
        matched(latest, criterion, objective.rubric.indexOf(criterion), true))) {
    return { kind: "independent-check", failedCriteria, evidenceIds: [latest.id] };
  }
  return { kind: "delayed-recall", failedCriteria: [], evidenceIds: [latest.id] };
}
