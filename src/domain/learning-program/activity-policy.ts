import type { LearningEvidence } from "../learning-state/types";
import type { LearningDecision, LearningObjective, LearningProgram } from "./types";
import { deriveObjectiveReadiness, objectiveEvidence, objectiveProgress,
  type ObjectiveReadiness } from "./objective-readiness";
import { decideFeedback } from "../learner-model/feedback-policy";

/** Policy configuration, not a second learning state or persisted learner preference. */
export interface AdaptivePolicyOptions {
  /** Minimum clock distance already enforced by canonical mastery (never weaken it). */
  recallDueGraceMinutes?: number;
  /** Repeat failures before one targeted scaffold. The default is two failures. */
  scaffoldAfterFailures?: number;
}

function normalized(options: AdaptivePolicyOptions) {
  const n = options.scaffoldAfterFailures ?? 2;
  const grace = options.recallDueGraceMinutes ?? 0;
  if (!Number.isInteger(n) || n < 2 || n > 5 ||
      !Number.isInteger(grace) || grace < 0 || grace > 60) {
    throw new Error("Invalid adaptive policy thresholds.");
  }
  return { scaffoldAfterFailures: n, recallDueGraceMs: grace * 60_000 };
}

/** Stable order from curriculum, with earlier actual due dates first. */
export function selectEligibleObjective(
  program: LearningProgram, evidence: readonly LearningEvidence[], now = Date.now(),
  options: AdaptivePolicyOptions = {},
): ObjectiveReadiness | null {
  const config = normalized(options);
  if (program.focus) {
    const focusObjective = program.objectives.find(item => item.id === program.focus?.objectiveId);
    return focusObjective && !focusObjective.deprecated
      ? deriveObjectiveReadiness(program, focusObjective.id, evidence, now) : null;
  }
  const candidates = program.objectives.filter(item => !item.deprecated)
    .map(item => deriveObjectiveReadiness(program, item.id, evidence, now))
    .filter(state => state.prerequisiteStatus === "eligible");
  const due = candidates.filter(state =>
    (state.progress.status === "mastered" || state.progress.status === "provisional") &&
    state.progress.dueAt !== null && now >= state.progress.dueAt + config.recallDueGraceMs)
    .sort((a,b) => (a.progress.dueAt ?? 0) - (b.progress.dueAt ?? 0) ||
      a.objective.id.localeCompare(b.objective.id));
  if (due[0]) return due[0];
  // Repair before starting a new topic, but never bounce to unrelated objectives
  // while the active focus is still pinned.
  const repair = candidates.find(state => state.progress.status === "remediate");
  if (repair) return repair;
  const transfer = candidates.find(state =>
    state.progress.status === "mastered" &&
    !objectiveEvidence(program, state.objective.id, [...evidence]).some(item =>
      item.taskKind === "transfer" && item.outcome === "correct" &&
      !item.assisted && item.assistance?.independent !== false));
  if (transfer) return transfer;
  return candidates.find(state => state.progress.status === "unseen" &&
    state.objective.priority !== "optional") ??
    candidates.find(state => state.progress.status === "unseen") ?? null;
}

export function decideLearningActivity(
  program: LearningProgram, readiness: ObjectiveReadiness,
  evidence: readonly LearningEvidence[], now = Date.now(),
  options: AdaptivePolicyOptions = {},
): LearningDecision {
  const config = normalized(options);
  const objective = readiness.objective;
  const progress = readiness.progress;
  if (readiness.prerequisiteStatus === "blocked" && !program.focus) {
    return { kind: "wait", objective, reason: "Objective prerequisites are not mastered." };
  }
  const attempts = objectiveEvidence(program, objective.id, [...evidence]);
  const last = attempts.at(-1);
  if (progress.status === "unseen") {
    return { kind: "diagnostic", objective, reason: "Prerequisites are satisfied; assess this objective first." };
  }
  if (progress.status === "remediate" && last) {
    const feedback = decideFeedback(objective, attempts, last,
      { scaffoldAfterFailures: config.scaffoldAfterFailures });
    const targetCriterionIds = feedback.failedCriteria.flatMap(criterion =>
      objective.criteria?.filter(item => item.description === criterion).map(item => item.id) ??
      objective.rubric.flatMap((text, i) => text === criterion ? ["legacy:" + (i + 1)] : []));
    const taught = program.instructionEvents?.some(item =>
      item.objectiveId === objective.id && item.afterEvidenceAt === last.createdAt);
    const kind: LearningDecision["kind"] = feedback.kind === "repair" ? "remediate" :
      feedback.kind === "scaffold" && !taught ? "teach" : "guided-practice";
    return {
      kind, objective, targetCriterionIds,
      sourceEvidenceIds: feedback.evidenceIds,
      ...(feedback.kind === "scaffold" ? { scaffoldLevel: feedback.level } : {}),
      reason: kind === "remediate" ? "Repair the failed criterion without a full answer reveal." :
        kind === "teach" ? "Repeated rubric failure needs one bounded scaffold." :
        "Try an independent variation; no additional full explanation.",
    };
  }
  if (progress.dueAt !== null && now >= progress.dueAt + config.recallDueGraceMs) {
    return { kind: "recall", objective, dueAt: progress.dueAt,
      reason: "Criterion-complete delayed recall is due." };
  }
  if (progress.status === "mastered" && !attempts.some(item =>
    item.taskKind === "transfer" && item.outcome === "correct" && !item.assisted &&
    item.assistance?.independent !== false)) {
    return { kind: "transfer", objective, reason: "Check independent transfer to a new context." };
  }
  if (progress.status === "provisional") {
    return { kind: "guided-practice", objective, reason: "Strengthen the skill independently before delayed recall." };
  }
  return { kind: "wait", objective,
    reason: "Checks complete for this objective; retain the scheduled recall.",
    dueAt: progress.dueAt ?? undefined };
}

/** Pure focus policy: the pinned objective wins; no timer or unrelated due work may preempt it. */
export function decideFocusedLearningActivity(
  program: LearningProgram, evidence: readonly LearningEvidence[], now = Date.now(),
  options: AdaptivePolicyOptions = {},
): LearningDecision {
  const focus = program.focus;
  if (!focus) throw new Error("No objective focus.");
  if (focus.status === "paused") return {
    kind: "wait", reason: "Objective focus paused. Use /resume-focus.",
  };
  const objective = program.objectives.find(item => item.id === focus.objectiveId);
  if (!objective || objective.deprecated || focus.curriculumRevision !== program.planVersion) {
    throw new Error("Focused objective is stale.");
  }
  return decideLearningActivity(program, deriveObjectiveReadiness(program, objective.id,
    evidence, now), evidence, now, options);
}

/** No eligible objective: do not thrash between completed topics before the next due recall. */
export function nextEligibleRecallAt(program: LearningProgram,
  evidence: readonly LearningEvidence[], now = Date.now()): number | undefined {
  return program.objectives.filter(item => !item.deprecated)
    .map(item => objectiveProgress(program, item.id, [...evidence], now).dueAt)
    .filter((due): due is number => due !== null && due > now)
    .sort((a,b)=>a-b)[0];
}
