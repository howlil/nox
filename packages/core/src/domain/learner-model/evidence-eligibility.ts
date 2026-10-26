import type { LearningEvidence } from "../learning-state/types";
import type { LearningObjective, LearningProgram } from "../learning-program/types";
import { criterionIdFor } from "./feedback-policy";

export function isCurrentPracticeEvidence(
  program: LearningProgram, objective: LearningObjective, item: LearningEvidence,
): boolean {
  return item.type === "practice" && item.scope === "learner" &&
    item.programId === program.id && item.objectiveId === objective.id &&
    item.evidenceVersion === 3 &&
    item.objectiveRevision === (objective.objectiveRevision ?? program.planVersion) &&
    typeof item.questionId === "string" && item.questionId.length > 0;
}
export function isIndependentEvidence(item: LearningEvidence): boolean {
  return item.assisted !== true && item.assessmentCoverage !== "single-item" &&
    item.assistance?.independent === true && item.assistance.highestHintLevel === 0;
}
export function hasCompleteRubric(objective: LearningObjective, item: LearningEvidence): boolean {
  const revision = objective.objectiveRevision ?? item.objectiveRevision;
  return revision !== undefined && objective.rubric.length > 0 &&
    objective.rubric.every((_, index) => item.rubricResults?.some(result =>
      result.criterionId === criterionIdFor(objective.id, revision, index) &&
      result.met === true) === true);
}
export function isStructuralEvidence(
  program: LearningProgram, objective: LearningObjective, item: LearningEvidence,
): boolean {
  return isCurrentPracticeEvidence(program, objective, item) &&
    Boolean(item.rubricResults?.length) &&
    item.rubricResults!.every(result => Boolean(result.criterionId));
}
