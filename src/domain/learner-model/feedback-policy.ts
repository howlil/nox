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
  // A demonstrated independent recovery resets scaffolding for this criterion.
  // Evidence operations are unique; replay of a question must not count twice.
  const recent = [...attempts].sort((a, b) =>
    a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const lastRepair = [...recent].reverse().find(item => item.createdAt <= latest.createdAt &&
    item.id !== latest.id && item.outcome === "correct" && !item.assisted &&
    item.assistance?.independent !== false && item.assessmentCoverage !== "single-item" &&
    failedCriteria.every(criterion =>
      matched(item, criterion, objective.rubric.indexOf(criterion), true)));
  const since = recent.filter(item => (!lastRepair ||
    item.createdAt > lastRepair.createdAt ||
    (item.createdAt === lastRepair.createdAt && item.id > lastRepair.id)) &&
    (item.createdAt < latest.createdAt ||
      (item.createdAt === latest.createdAt && item.id <= latest.id)));
  const failures = since.filter(item => item.outcome !== "correct" &&
    failedCriteria.some(criterion =>
      matched(item, criterion, objective.rubric.indexOf(criterion), false)));
  const uniqueFailures = failures.filter((item, index, all) =>
    all.findIndex(other => (other.questionId ?? other.id) === (item.questionId ?? item.id)) === index);
  const failureCount = uniqueFailures.length;
  if (latest.outcome === "incorrect" || latest.outcome === "partial") {
    if (failedCriteria.length > 0 && failureCount >= threshold) {
      // The first repeat receives a limited scaffold; higher levels require
      // explicit policy and hint UX so help cannot silently escalate.
      return { kind: "scaffold",
        level: Math.min(4, failureCount - threshold + 2) as 1 | 2 | 3 | 4,
        failedCriteria, evidenceIds: uniqueFailures.slice(-2).map(item => item.id) };
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
