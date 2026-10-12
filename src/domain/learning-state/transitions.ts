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
  };

  next.evidence.push(evidence);
  next.currentTopic = input.evaluation.concept;

  for (const misconception of input.evaluation.misconceptions) {
    const existing = next.gaps.find(
      (gap) =>
        normalize(gap.concept) === normalize(input.evaluation.concept) &&
        normalize(gap.reason) === normalize(misconception),
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
    });
  }

  if (
    input.evaluation.outcome === "correct" &&
    input.evaluation.misconceptions.length === 0
  ) {
    for (const gap of next.gaps) {
      if (
        normalize(gap.concept) === normalize(input.evaluation.concept) &&
        gap.status === "open"
      ) {
        gap.status = "improving";
        if (!gap.evidenceIds.includes(evidence.id)) {
          gap.evidenceIds.push(evidence.id);
        }
      }
    }
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
