import type { LearningProgram } from "../domain/learning-program/types";
import type { PracticeEvaluation } from "../domain/practice/types";
import type { PracticeEvaluationAttempt } from "../domain/practice/PracticeStateMachine";

// An executable grader needs a trusted sandbox receipt; this boundary cannot mint one.
type Evaluator = "deterministic" | "llm-review";

/** The application, never the provider, assigns identity and evaluator provenance. */
export function attachAssessmentProvenance(
  evaluation: PracticeEvaluation,
  attempt: PracticeEvaluationAttempt,
  program: LearningProgram | undefined,
  evaluator: Evaluator,
): PracticeEvaluation {
  if (evaluator !== "deterministic" && evaluator !== "llm-review") {
    throw new Error("Verified execution requires a trusted sandbox receipt.");
  }
  const objective = program?.objectives.find(item => item.id === attempt.objectiveId);
  if (attempt.programId && (!program || program.id !== attempt.programId || !objective)) {
    throw new Error("Cannot bind assessment to a missing learning objective.");
  }
  const highestHintLevel = attempt.highestHintLevel ?? (attempt.assisted ? 1 : 0);
  if (!Number.isInteger(highestHintLevel) || highestHintLevel < 0 || highestHintLevel > 4) {
    throw new Error("Invalid persisted assistance level.");
  }
  // Discard provider-supplied IDs. Only source-validated rubric descriptors
  // can be associated with stored criterion identities.
  const rubricResults = evaluation.rubricResults?.map(result => {
    const criterion = objective?.criteria?.find(item => item.description === result.criterion);
    return {
      criterion: result.criterion,
      met: result.met,
      evidence: result.evidence,
      ...(criterion ? { criterionId: criterion.id } : {}),
    };
  });
  return {
    ...evaluation,
    programId: attempt.programId,
    objectiveId: attempt.objectiveId,
    ...(attempt.programId ? { nextQuestion: undefined } : {}),
    assisted: highestHintLevel > 0,
    assistance: { highestHintLevel: highestHintLevel as 0 | 1 | 2 | 3 | 4,
      independent: highestHintLevel === 0 },
    evaluator,
    ...(attempt.programId ? { objectiveRevision: program!.planVersion } : {}),
    focusSessionId: attempt.questionSpec?.focusSessionId,
    ...(rubricResults ? { rubricResults } : {}),
    taskKind: attempt.taskKind,
  };
}
