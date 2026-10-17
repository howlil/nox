import type { LearningObjective } from "../learning-program/types";
import type { LearningEvidence } from "../learning-state/types";

/**
 * These criterion IDs are stable inside an objective revision. A structural
 * rubric change must increment the revision (enforced by M2).
 */
export function criterionIdFor(objectiveId: string, revision: number, index: number): string {
  return `${encodeURIComponent(objectiveId)}@${revision}:criterion-${index + 1}`;
}

export type FeedbackDecision =
  | { kind: "repair"; failedCriterionIds: string[] }
  | { kind: "scaffold"; level: 1 | 2 | 3 | 4; failedCriterionIds: string[] }
  | { kind: "independent-check" }
  | { kind: "transfer-check" }
  | { kind: "delayed-recall"; dueAt: number }
  | { kind: "ready-to-advance" };

const RETRIEVAL_DELAY_MS = 12 * 60 * 60 * 1000;

function independent(evidence: LearningEvidence): boolean {
  return evidence.assistance?.independent === true ||
    (evidence.assistance === undefined && evidence.assisted === false);
}

function eligible(evidence: LearningEvidence): boolean {
  return evidence.type === "practice" && evidence.scope === "learner" &&
    evidence.assessmentCoverage !== "single-item";
}

/** No provider calls, wall-clock reads, writes or uncalibrated mastery scores. */
export function decideFeedback(
  objective: LearningObjective,
  evidence: readonly LearningEvidence[],
  lastAttempt: LearningEvidence,
): FeedbackDecision {
  if (!lastAttempt.programId || !lastAttempt.objectiveId ||
      lastAttempt.objectiveId !== objective.id ||
      lastAttempt.objectiveRevision === undefined) {
    return { kind: "repair", failedCriterionIds: [] };
  }

  const history = evidence.filter(item => eligible(item) &&
    item.programId === lastAttempt.programId && item.objectiveId === objective.id &&
    item.objectiveRevision === lastAttempt.objectiveRevision)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const failures = lastAttempt.rubricResults?.filter(result => !result.met &&
    result.criterionId).map(result => result.criterionId!) ?? [];

  if (lastAttempt.outcome !== "correct") {
    const repeated = failures.some(id => history.filter(item => item.rubricResults?.some(
      result => result.criterionId === id && !result.met,
    )).length >= 2);
    if (repeated) {
      const level = Math.min(4, Math.max(2, history.filter(item =>
        item.rubricResults?.some(result => failures.includes(result.criterionId ?? "") && !result.met),
      ).length)) as 2 | 3 | 4;
      return { kind: "scaffold", level, failedCriterionIds: failures };
    }
    return { kind: "repair", failedCriterionIds: failures };
  }
  if (!independent(lastAttempt) || lastAttempt.assessmentCoverage === "single-item") {
    return { kind: "independent-check" };
  }

  // A passing aggregate score never overrides a missing required criterion.
  const complete = objective.rubric.every((_, index) =>
    lastAttempt.rubricResults?.some(result => result.criterionId ===
      criterionIdFor(objective.id, lastAttempt.objectiveRevision!, index) && result.met) === true);
  if (!complete || !objective.rubric.length) {
    return { kind: "repair", failedCriterionIds: objective.rubric.map((_, index) =>
      criterionIdFor(objective.id, lastAttempt.objectiveRevision!, index))
      .filter(id => !lastAttempt.rubricResults?.some(result => result.criterionId === id && result.met)) };
  }

  const correctIndependent = history.filter(item => item.outcome === "correct" &&
    independent(item) && item.rubricResults?.every(result => result.met) &&
    objective.rubric.every((_, index) => item.rubricResults?.some(result => result.criterionId ===
      criterionIdFor(objective.id, lastAttempt.objectiveRevision!, index) && result.met)));
  const first = correctIndependent[0];
  const recalled = first && correctIndependent.some(item =>
    item.id !== first.id && item.taskKind === "recall" &&
    item.createdAt - first.createdAt >= RETRIEVAL_DELAY_MS);
  if (!recalled) {
    return { kind: "delayed-recall", dueAt: (first?.createdAt ?? lastAttempt.createdAt) + RETRIEVAL_DELAY_MS };
  }
  // Transfer must be demonstrated when the objective expressly requires it.
  if (objective.requiresTransfer === true && !correctIndependent.some(item => item.taskKind === "transfer")) {
    return { kind: "transfer-check" };
  }
  return { kind: "ready-to-advance" };
}
