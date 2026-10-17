import type { KnowledgeGap, LearningEvidence } from "../learning-state/types";
import type { LearningProgram } from "../learning-program/types";
import { deriveObjectiveReadiness, objectiveProgress } from "../learning-program/objective-readiness";

export type CriterionReadiness = "unseen" | "developing" | "demonstrated" | "needs-repair";

export interface DerivedCriterionState {
  criterionId: string;
  description: string;
  status: CriterionReadiness;
  evidenceIds: string[];
  unresolvedGapIds: string[];
}

export interface DerivedObjectiveState {
  objectiveId: string;
  deprecated: boolean;
  criteria: DerivedCriterionState[];
  attempts: number;
  assistedAttempts: number;
  lastIndependentAttemptAt?: number;
  nextRecallAt?: number;
  recallReadiness: "unseen" | "needs-repair" | "practice" | "due" | "scheduled";
}

export interface LearnerModel {
  programId: string;
  curriculumRevision: number;
  /** Stable derived fingerprint for cache invalidation, not proof or an authority token. */
  evidenceRevision: string;
  objectives: Record<string, DerivedObjectiveState>;
}

export interface SelectedLearnerContext {
  programId: string;
  objectiveId: string;
  curriculumRevision: number;
  evidenceRevision: string;
  objective: DerivedObjectiveState;
  prerequisites: Array<{ objectiveId: string; recallReadiness: DerivedObjectiveState["recallReadiness"]; evidenceIds: string[] }>;
  episodes: Array<{ evidenceId: string; objectiveId: string; createdAt: number;
    taskKind?: LearningEvidence["taskKind"]; outcome?: string; criterionIds: string[];
    assisted: boolean; highestHintLevel: number }>;
  gaps: Array<{ gapId: string; objectiveId: string; reason: string; evidenceIds: string[] }>;
}

const isIndependent = (item: LearningEvidence) =>
  !item.assisted && item.assistance?.independent !== false &&
  (item.assistance?.highestHintLevel ?? 0) === 0;

const sortEvidence = (items: readonly LearningEvidence[]) => [...items]
  .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

function canonicalProgramEvidence(program: LearningProgram, evidence: readonly LearningEvidence[]) {
  const ids = new Set(program.objectives.map(item => item.id));
  return sortEvidence(evidence.filter(item =>
    item.scope === "learner" && item.type === "practice" &&
    item.programId === program.id && Boolean(item.objectiveId && ids.has(item.objectiveId))));
}

/** Not a cryptographic signature. Any changed canonical provenance invalidates the cache key. */
function fingerprint(program: LearningProgram, evidence: readonly LearningEvidence[],
  gaps: readonly KnowledgeGap[]): string {
  const canonical = JSON.stringify({
    programId: program.id, curriculumRevision: program.planVersion,
    evidence: evidence.map(item => ({
      id: item.id, objectiveId: item.objectiveId, createdAt: item.createdAt,
      questionId: item.questionId, objectiveRevision: item.objectiveRevision,
      evaluator: item.evaluator, outcome: item.outcome, taskKind: item.taskKind,
      assisted: item.assisted,
      assistance: item.assistance, coverage: item.assessmentCoverage,
      rubricResults: item.rubricResults?.map(r => [r.criterionId, r.criterion, r.met]),
    })),
    gaps: [...gaps].sort((a,b)=>a.id.localeCompare(b.id)).map(g => ({
      id: g.id, status: g.status, objectiveId: g.objectiveId,
      reason: g.reason, evidenceIds: g.evidenceIds,
    })),
  });
  // Two 32-bit deterministic accumulators; collision-tolerant because only
  // a disposable projection cache may use the fingerprint.
  let a = 2166136261, b = 2246822519;
  for (let i = 0; i < canonical.length; i++) {
    const value = canonical.charCodeAt(i);
    a = Math.imul(a ^ value, 16777619);
    b = Math.imul(b ^ value, 3266489917);
  }
  return (a >>> 0).toString(16).padStart(8, "0") +
    (b >>> 0).toString(16).padStart(8, "0") + ":" + evidence.length;
}

function matchingResult(item: LearningEvidence, criterionId: string,
  description: string, planVersion: number) {
  // Revisioned evidence without matching stable IDs, or from a future plan,
  // must never silently match legacy text or confer demonstrated status.
  if (item.objectiveRevision !== undefined &&
      (item.objectiveRevision < 1 || item.objectiveRevision > planVersion)) return undefined;
  return item.rubricResults?.find(result => item.objectiveRevision !== undefined
    ? result.criterionId === criterionId : result.criterion === description);
}

export function projectLearnerModel(program: LearningProgram,
  evidence: readonly LearningEvidence[], gaps: readonly KnowledgeGap[] = [],
  now = Date.now()): LearnerModel {
  const scoped = canonicalProgramEvidence(program, evidence);
  const objectiveIds = new Set(program.objectives.map(item => item.id));
  const activeGaps = gaps.filter(gap => gap.programId === program.id &&
    Boolean(gap.objectiveId && objectiveIds.has(gap.objectiveId)) &&
    gap.status !== "resolved");
  const objectives: Record<string, DerivedObjectiveState> = Object.create(null) as Record<string, DerivedObjectiveState>;
  for (const objective of program.objectives) {
    const attempts = scoped.filter(item => item.objectiveId === objective.id);
    const objectiveGaps = activeGaps.filter(gap => gap.objectiveId === objective.id);
    // Historical tombstones are readable, never eligible for a new activity.
    const readiness = objective.deprecated ? null :
      deriveObjectiveReadiness(program, objective.id, scoped, now, {}, gaps);
    const progress = readiness?.progress ?? objectiveProgress(program, objective.id, scoped, now);
    const criteria = objective.rubric.map((description, index): DerivedCriterionState => {
      const criterionId = objective.criteria?.[index]?.id ?? "legacy:" + (index + 1);
      const observations = attempts.flatMap(item => {
        const result = matchingResult(item, criterionId, description, program.planVersion);
        return result ? [{ item, met: result.met }] : [];
      });
      const latest = observations.at(-1);
      const unresolvedGapIds = objectiveGaps.filter(gap => gap.evidenceIds.some(id =>
        observations.some(obs => obs.item.id === id && !obs.met))).map(gap => gap.id);
      return {
        criterionId, description,
        status: unresolvedGapIds.length > 0 || (latest && !latest.met)
          ? "needs-repair" : !latest ? "unseen" :
            latest.met && isIndependent(latest.item) ? "demonstrated" : "developing",
        evidenceIds: observations.slice(-4).map(obs => obs.item.id),
        unresolvedGapIds,
      };
    });
    const lastIndependentAttemptAt = attempts.filter(isIndependent).at(-1)?.createdAt;
    const nextRecallAt = progress.dueAt ?? undefined;
    const recallReadiness: DerivedObjectiveState["recallReadiness"] =
      objective.deprecated ? "unseen" :
      progress.status === "unseen" ? "unseen" :
      (readiness?.unresolvedGapIds.length ?? 0) > 0 || progress.status === "remediate" ? "needs-repair" :
      progress.dueAt !== null && now >= progress.dueAt ? "due" :
      progress.dueAt !== null ? "scheduled" : "practice";
    objectives[objective.id] = {
      objectiveId: objective.id, deprecated: Boolean(objective.deprecated),
      criteria, attempts: attempts.length,
      assistedAttempts: attempts.filter(item => !isIndependent(item)).length,
      ...(lastIndependentAttemptAt !== undefined ? { lastIndependentAttemptAt } : {}),
      ...(nextRecallAt !== undefined ? { nextRecallAt } : {}),
      recallReadiness,
    };
  }
  return {
    programId: program.id, curriculumRevision: program.planVersion,
    evidenceRevision: fingerprint(program, scoped, activeGaps), objectives,
  };
}

/**
 * Bound learning memory to the active objective and its declared prerequisites.
 * No transcript dump, free-text personality inference, or cross-program evidence.
 */
export function selectRelevantLearnerState(
  program: LearningProgram, model: LearnerModel,
  evidence: readonly LearningEvidence[], gaps: readonly KnowledgeGap[],
  objectiveId: string, options: { maxEpisodes?: number; maxGaps?: number } = {},
): SelectedLearnerContext {
  const scopedForCheck = canonicalProgramEvidence(program, evidence);
  const relevantGaps = gaps.filter(gap => gap.programId === program.id &&
    gap.status !== "resolved" && program.objectives.some(item => item.id === gap.objectiveId));
  if (model.programId !== program.id || model.curriculumRevision !== program.planVersion ||
      model.evidenceRevision !== fingerprint(program, scopedForCheck, relevantGaps)) {
    throw new Error("Learner model is stale for the active curriculum or evidence.");
  }
  const active = program.objectives.find(item => item.id === objectiveId && !item.deprecated);
  const objective = model.objectives[objectiveId];
  if (!active || !objective) throw new Error("Unknown or deprecated learning objective.");
  const maxEpisodes = Math.max(1, Math.min(8, Math.floor(options.maxEpisodes ?? 5)));
  const maxGaps = Math.max(0, Math.min(5, Math.floor(options.maxGaps ?? 3)));
  const prerequisiteIds = new Set(active.prerequisiteIds.filter(id =>
    program.objectives.some(item => item.id === id && !item.deprecated)));
  const acceptedIds = new Set([objectiveId, ...prerequisiteIds]);
  const scoped = canonicalProgramEvidence(program, evidence).filter(item =>
    Boolean(item.objectiveId && acceptedIds.has(item.objectiveId)));
  const current = scoped.filter(item => item.objectiveId === objectiveId);
  const related = scoped.filter(item => item.objectiveId !== objectiveId);
  // Prioritize current failed criterion, latest independent work, most recent attempt,
  // and matching prerequisite evidence. Deduplicate in deterministic order.
  const failed = [...current].reverse().filter(item => item.rubricResults?.some(r => !r.met));
  const independent = [...current].reverse().filter(isIndependent);
  const latest = [...current].reverse();
  const prereqs = [...related].reverse();
  const ranked = [...failed.slice(0, 2), ...independent.slice(0, 2), ...latest.slice(0, 3),
    ...prereqs.slice(0, 2)];
  const seen = new Set<string>();
  const episodes = ranked.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, maxEpisodes).map(item => {
    const learningObjective = program.objectives.find(obj => obj.id === item.objectiveId);
    return {
      evidenceId: item.id, objectiveId: item.objectiveId!,
      createdAt: item.createdAt, ...(item.taskKind ? { taskKind: item.taskKind } : {}),
      ...(item.outcome ? { outcome: item.outcome } : {}),
      criterionIds: (item.rubricResults ?? []).filter(r => !r.met).map(r =>
        item.objectiveRevision !== undefined ? (r.criterionId ?? "unattributed") :
          (learningObjective?.criteria?.find(c => c.description === r.criterion)?.id ?? "legacy")),
      assisted: !isIndependent(item),
      highestHintLevel: item.assistance?.highestHintLevel ?? (item.assisted ? 1 : 0),
    };
  });
  const relevantIds = new Set(episodes.map(item => item.evidenceId));
  const selectedGaps = (maxGaps === 0 ? [] : gaps.filter(gap => gap.programId === program.id &&
    gap.objectiveId === objectiveId && gap.status !== "resolved" &&
    gap.evidenceIds.some(id => relevantIds.has(id))).slice(-maxGaps))
    .map(gap => ({ gapId: gap.id, objectiveId, reason: gap.reason.slice(0, 240),
      evidenceIds: gap.evidenceIds.filter(id => relevantIds.has(id)).slice(-3) }));
  return {
    programId: program.id, objectiveId, curriculumRevision: model.curriculumRevision,
    evidenceRevision: model.evidenceRevision,
    objective: { ...structuredClone(objective),
      criteria: objective.criteria.slice(0, 12).map(item => ({
        ...item, description: item.description.slice(0, 180),
        evidenceIds: item.evidenceIds.slice(-4),
        unresolvedGapIds: item.unresolvedGapIds.slice(-3),
      })) },
    prerequisites: [...prerequisiteIds].slice(0, 6).map(id => ({
      objectiveId: id, recallReadiness: model.objectives[id].recallReadiness,
      evidenceIds: prereqs.filter(item => item.objectiveId === id).slice(-2).map(item => item.id),
    })),
    episodes, gaps: selectedGaps,
  };
}
