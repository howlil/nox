import {
  LearningEvidence,
  LearningState,
} from "./types";
import { PracticeEvaluation } from "../practice/types";
import { deriveGapStatus } from "./gap-projection";
import { ReviewFinding } from "../review/types";

export interface LearningTransitionDeps {
  now?: () => number;
  uuid?: () => string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function cloneState(state: LearningState): LearningState {
  return {
    ...state,
    gaps: state.gaps.map((gap) => ({
      ...gap,
      evidenceIds: [...gap.evidenceIds],
    })),
    evidence: state.evidence.map((item) => ({ ...item,
      ...(item.rubricResults ? { rubricResults: item.rubricResults.map(result => ({ ...result })) } : {}),
      ...(item.assistance ? { assistance: { ...item.assistance } } : {}),
    })),
  };
}

function resolveDeps(deps: LearningTransitionDeps) {
  return {
    now: deps.now ?? Date.now,
    uuid: deps.uuid ?? (() => crypto.randomUUID()),
  };
}

export function recordPracticeEvaluation(
  state: LearningState,
  input: {
    evaluation: PracticeEvaluation;
    source: string;
    evidenceId?: string;
    programId?: string;
    objectiveId?: string;
    assisted?: boolean;
    questionId?: string;
  },
  deps: LearningTransitionDeps = {},
): LearningState {
  const next = cloneState(state);
  if (input.evidenceId && next.evidence.some((evidence) => evidence.id === input.evidenceId)) {
    return next;
  }
  const resolved = resolveDeps(deps);
  next.version = 3;
  const versioned = Boolean(input.programId && input.objectiveId && input.questionId &&
    input.evaluation.objectiveRevision !== undefined && input.evaluation.assistance &&
    input.evaluation.evaluator);

  const evidence: LearningEvidence = {
    id: input.evidenceId ?? resolved.uuid(),
    type: "practice",
    scope: "learner",
    concept: input.evaluation.concept,
    source: input.source,
    outcome: input.evaluation.outcome,
    createdAt: resolved.now(),
    ...(input.programId ? { programId: input.programId } : {}),
    ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
    ...(input.assisted ? { assisted: true } : {}),
    ...(input.evaluation.assessmentCoverage ? { assessmentCoverage: input.evaluation.assessmentCoverage } : {}),
    ...(input.evaluation.taskKind ? { taskKind: input.evaluation.taskKind } : {}),
    ...(input.evaluation.rubricResults ? { rubricResults: input.evaluation.rubricResults.map(result => ({ ...result })) } : {}),
    ...(input.questionId ? { questionId: input.questionId } : {}),
    ...(input.evaluation.objectiveRevision !== undefined ? { objectiveRevision: input.evaluation.objectiveRevision } : {}),
    ...(input.evaluation.assistance ? { assistance: { ...input.evaluation.assistance } } : {}),
    ...(input.evaluation.evaluator ? { evaluator: input.evaluation.evaluator } : {}),
    ...(versioned ? { evidenceVersion: 3 as const } : {}),
  };

  next.evidence.push(evidence);
  next.currentTopic = input.evaluation.concept;

  // Criterion-specific gaps have direct provenance; free-form misconception
  // strings remain separate because their semantic linkage is unverified.
  if (input.programId && input.objectiveId) {
    for (const result of evidence.rubricResults ?? []) {
      if (result.met || !result.criterionId) continue;
      const existing = next.gaps.find(gap => gap.programId === input.programId &&
        gap.objectiveId === input.objectiveId && gap.criterionId === result.criterionId);
      if (!existing) {
        next.gaps.push({
          id: resolved.uuid(), concept: evidence.concept,
          reason: `Criterion not met: ${result.criterion}`,
          programId: input.programId, objectiveId: input.objectiveId,
          criterionId: result.criterionId, status: "open", evidenceIds: [evidence.id],
        });
      }
    }
  }

  for (const misconception of input.evaluation.misconceptions) {
    const existing = next.gaps.find(
      (gap) =>
        normalize(gap.concept) === normalize(input.evaluation.concept) &&
        normalize(gap.reason) === normalize(misconception) &&
        gap.programId === input.programId && gap.objectiveId === input.objectiveId,
    );

    if (existing) {
      if (!existing.evidenceIds.includes(evidence.id)) {
        existing.evidenceIds.push(evidence.id);
      }
      existing.status = "open";
      continue;
    }

    next.gaps.push({
      id: resolved.uuid(),
      concept: input.evaluation.concept,
      reason: misconception,
      evidenceIds: [evidence.id],
      status: "open",
      ...(input.programId ? { programId: input.programId } : {}),
      ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
    });
  }

  if (
    input.evaluation.outcome === "correct" &&
    input.evaluation.misconceptions.length === 0
  ) {
    for (const gap of next.gaps) {
      if (
        normalize(gap.concept) === normalize(input.evaluation.concept) &&
        gap.programId === input.programId && gap.objectiveId === input.objectiveId &&
        gap.status === "open"
      ) {
        gap.status = "improving";
        if (!gap.evidenceIds.includes(evidence.id)) {
          gap.evidenceIds.push(evidence.id);
        }
      }
    }
  }

  for (const gap of next.gaps) {
    if (!gap.criterionId || gap.programId !== input.programId ||
        gap.objectiveId !== input.objectiveId) continue;
    if (evidence.rubricResults?.some(result => result.criterionId === gap.criterionId) &&
        !gap.evidenceIds.includes(evidence.id)) {
      gap.evidenceIds.push(evidence.id);
    }
    gap.status = deriveGapStatus(gap, next.evidence);
  }

  return next;
}

export function recordReviewFindings(
  state: LearningState,
  input: {
    findings: ReviewFinding[];
    source: string;
    reviewId?: string;
  },
  deps: LearningTransitionDeps = {},
): LearningState {
  if (input.findings.length === 0) return state;

  const next = cloneState(state);
  const resolved = resolveDeps(deps);

  for (const [index, finding] of input.findings.entries()) {
    const id = input.reviewId ? `${input.reviewId}:${index}` : resolved.uuid();
    if (next.evidence.some((item) => item.id === id)) continue;
    const evidence: LearningEvidence = {
      id,
      type: "review",
      scope: "material",
      concept: finding.concept,
      source: input.source,
      outcome: finding.kind,
      createdAt: resolved.now(),
    };

    next.evidence.push(evidence);
    next.currentTopic = finding.concept;
  }

  return next;
}
