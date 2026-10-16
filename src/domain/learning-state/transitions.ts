import {
  LearningEvidence,
  LearningState,
} from "./types";
import { PracticeEvaluation } from "../practice/types";
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
    evidence: state.evidence.map((item) => ({ ...item })),
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
  },
  deps: LearningTransitionDeps = {},
): LearningState {
  const next = cloneState(state);
  if (input.evidenceId && next.evidence.some((evidence) => evidence.id === input.evidenceId)) {
    return next;
  }
  const resolved = resolveDeps(deps);

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
    ...(input.evaluation.rubricResults ? { rubricResults: input.evaluation.rubricResults } : {}),
  };

  next.evidence.push(evidence);
  next.currentTopic = input.evaluation.concept;

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

  // A gap can only close from new evidence about its own failed criterion.
  // Historical correct answers and ordinary spaced practice must not close it.
  for (const gap of next.gaps) {
    if (gap.status !== "improving" || gap.programId !== input.programId ||
        gap.objectiveId !== input.objectiveId) continue;
    const relatedFailures = next.evidence.filter(item =>
      gap.evidenceIds.includes(item.id) && item.type === "practice" &&
      (item.outcome === "incorrect" || item.outcome === "partial"))
      .sort((left, right) => left.createdAt - right.createdAt);
    const failed = relatedFailures.at(-1);
    if (!failed || failed.createdAt <= 0) continue;
    const failedCriteria = failed.rubricResults?.filter(item => !item.met)
      .map(item => item.criterion) ?? [];
    // Without unambiguous criterion attribution, retain the gap for review.
    if (failedCriteria.length !== 1) continue;
    const criterion = failedCriteria[0];
    const independent = next.evidence.filter(item =>
      item.scope === "learner" && item.type === "practice" &&
      item.programId === input.programId && item.objectiveId === input.objectiveId &&
      item.createdAt > failed.createdAt && item.outcome === "correct" &&
      !item.assisted && item.assessmentCoverage !== "single-item" &&
      Boolean(item.rubricResults?.length) && item.rubricResults!.every(result => result.met) &&
      item.rubricResults!.some(result => result.criterion === criterion && result.met));
    const verifiedRecall = independent.some(first => first.taskKind !== "recall" &&
      independent.some(recall => recall.taskKind === "recall" &&
        recall.createdAt - first.createdAt >= 12 * 3_600_000));
    if (verifiedRecall) gap.status = "resolved";
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
