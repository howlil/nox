import type { LearningEvidence, KnowledgeGap } from "../learning-state/types";
import type { LearningProgram } from "../learning-program/types";

export interface CriterionProjection {
  criterion: string;
  status: "unseen" | "needs-repair" | "developing" | "demonstrated";
  evidenceIds: string[];
}
export interface ObjectiveProjection {
  programId: string;
  objectiveId: string;
  attempts: number;
  assistedAttempts: number;
  lastOutcome?: string;
  criteria: CriterionProjection[];
  activeGapReasons: string[];
}

/** Reconstructible learner view; never persisted as competing authority. */
export function projectObjectiveLearnerModel(
  program: LearningProgram, objectiveId: string,
  evidence: readonly LearningEvidence[], gaps: readonly KnowledgeGap[],
): ObjectiveProjection {
  const objective = program.objectives.find(item => item.id === objectiveId);
  if (!objective) throw new Error("Unknown learning objective.");
  const attempts = evidence.filter(item =>
    item.scope === "learner" && item.type === "practice" &&
    item.programId === program.id && item.objectiveId === objectiveId)
    .sort((a,b) => a.createdAt - b.createdAt);
  return {
    programId: program.id, objectiveId, attempts: attempts.length,
    assistedAttempts: attempts.filter(item => item.assisted).length,
    lastOutcome: attempts.at(-1)?.outcome,
    criteria: objective.rubric.map(criterion => {
      const observations = attempts.flatMap(item => (item.rubricResults ?? [])
        .filter(result => result.criterion === criterion)
        .map(result => ({ met: result.met, id: item.id, assisted: item.assisted })));
      const latest = observations.at(-1);
      const independent = observations.some(item => item.met && !item.assisted);
      return { criterion, status: !latest ? "unseen" : !latest.met ? "needs-repair" :
        independent ? "demonstrated" : "developing",
        evidenceIds: observations.slice(-3).map(item => item.id) };
    }),
    activeGapReasons: gaps.filter(item =>
      item.programId === program.id && item.objectiveId === objectiveId &&
      item.status !== "resolved").slice(-5).map(item => item.reason),
  };
}
export function summarizeObjectiveContext(model: ObjectiveProjection): string {
  return JSON.stringify({
    attempts: model.attempts, assistedAttempts: model.assistedAttempts,
    lastOutcome: model.lastOutcome,
    criteria: model.criteria.map(item => ({ criterion: item.criterion, status: item.status })),
    unresolvedMisconceptions: model.activeGapReasons,
  });
}
