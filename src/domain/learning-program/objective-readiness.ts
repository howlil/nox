import type { LearningEvidence } from "../learning-state/types";
import type { LearningProgram, LearningObjective } from "./types";

export interface RetentionPolicy {
  minIndependentRecallHours?: number;
  provisionalReviewHours?: number;
  masteredReviewHours?: number;
}
export function normalizeRetentionPolicy(options: RetentionPolicy = {}) {
  const gap = options.minIndependentRecallHours ?? 12;
  const provisional = options.provisionalReviewHours ?? 24;
  const mastered = options.masteredReviewHours ?? 72;
  if (![gap, provisional, mastered].every(Number.isInteger) ||
      gap < 12 || gap > 168 || provisional < 12 || provisional > 168 ||
      mastered < 24 || mastered > 720 || mastered < provisional) {
    throw new Error("Invalid retention thresholds; delayed recall must remain >= 12 hours.");
  }
  return { minGapMs: gap * 3_600_000, provisionalMs: provisional * 3_600_000,
    masteredMs: mastered * 3_600_000 };
}

/** Canonical, read-only mastery policy; legacy outcomes remain conservatively text-bound. */
export function objectiveEvidence(program: LearningProgram, objectiveId: string, evidence: LearningEvidence[]) {
  return evidence
    .filter(item => item.scope === "learner" && item.type === "practice" &&
      item.programId === program.id && item.objectiveId === objectiveId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function objectiveProgress(program: LearningProgram, objectiveId: string,
  evidence: LearningEvidence[], now = Date.now(), retention: RetentionPolicy = {}) {
  const schedule = normalizeRetentionPolicy(retention);
  const attempts = objectiveEvidence(program, objectiveId, evidence);
  if (!attempts.length) return { status: "unseen" as const, dueAt: null, attempts: 0 };
  const last = attempts[attempts.length - 1];
  const objective = program.objectives.find(item => item.id === objectiveId);
  const rubric = objective?.rubric ?? [];
  const independentAnswer = (item: LearningEvidence): boolean =>
    !item.assisted && item.assistance?.independent !== false &&
      (item.assistance?.highestHintLevel ?? 0) === 0;
  const complete = (item: LearningEvidence): boolean =>
    rubric.length > 0 && rubric.every((criterion, index) =>
      item.rubricResults?.some(result => {
        if (!result.met) return false;
        const stableId = objective?.criteria?.[index]?.id;
        // Rewording may preserve a stable criterion ID; changing its meaning
        // must allocate a new ID. Legacy unversioned evidence is text-bound.
        if (item.objectiveRevision !== undefined) {
          return Boolean(stableId && result.criterionId === stableId &&
            item.objectiveRevision >= 1 && item.objectiveRevision <= program.planVersion);
        }
        return result.criterion === criterion;
      }));
  if (last.outcome !== "correct" || !independentAnswer(last) || last.assessmentCoverage === "single-item" ||
      last.createdAt <= 0 || !complete(last)) {
    return { status: "remediate" as const, dueAt: null, attempts: attempts.length };
  }
  const correct = attempts.filter(item => item.outcome === "correct" && independentAnswer(item) &&
    item.assessmentCoverage !== "single-item" && item.createdAt > 0 && complete(item));
  // Repetition is not retention: only genuine delayed recall after earlier
  // independent criterion-complete practice qualifies for mastery.
  const independent = correct.some(first => first.taskKind !== "recall" &&
    correct.some(recall => recall.taskKind === "recall" &&
      recall.createdAt - first.createdAt >= schedule.minGapMs));
  const dueAt = last.createdAt + (independent ? schedule.masteredMs : schedule.provisionalMs);
  return { status: independent ? "mastered" as const : "provisional" as const,
    dueAt, attempts: attempts.length, due: now >= dueAt };
}


export interface ObjectiveReadiness {
  objective: LearningObjective;
  progress: ReturnType<typeof objectiveProgress>;
  prerequisiteStatus: "eligible" | "blocked";
  blockedBy: string[];
  lastEvidenceId?: string;
  failedCriterionIds: string[];
  failedEvidenceIds: string[];
}

export function deriveObjectiveReadiness(
  program: LearningProgram, objectiveId: string, evidence: readonly LearningEvidence[],
  now = Date.now(), retention: RetentionPolicy = {},
): ObjectiveReadiness {
  const objective = program.objectives.find(item => item.id === objectiveId);
  if (!objective || objective.deprecated) throw new Error("Unknown or deprecated learning objective.");
  const source = [...evidence];
  const progress = objectiveProgress(program, objectiveId, source, now, retention);
  const blockedBy = objective.prerequisiteIds.filter(id => {
    const required = program.objectives.find(item => item.id === id);
    return !required || required.deprecated ||
      objectiveProgress(program, id, source, now, retention).status !== "mastered";
  });
  const attempts = objectiveEvidence(program, objectiveId, source);
  const last = attempts.at(-1);
  const failed = last?.rubricResults?.filter(result => !result.met) ?? [];
  const failedCriterionIds = objective.rubric.flatMap((criterion, index) => {
    const matches = failed.some(result => last?.objectiveRevision !== undefined
      ? Boolean(objective.criteria?.[index] &&
        result.criterionId === objective.criteria[index].id) :
      result.criterion === criterion);
    return matches ? [objective.criteria?.[index]?.id ?? "legacy:" + (index + 1)] : [];
  });
  const badEvidence = [...attempts].reverse().filter(item =>
    (item.outcome === "incorrect" || item.outcome === "partial") &&
    item.rubricResults?.some(result => !result.met)).slice(0, 2);
  return {
    objective, progress, blockedBy, prerequisiteStatus: blockedBy.length ? "blocked" : "eligible",
    ...(last ? { lastEvidenceId: last.id } : {}),
    failedCriterionIds, failedEvidenceIds: badEvidence.map(item => item.id),
  };
}
