import assert from "node:assert/strict";
import test from "node:test";
import { deriveGapStatus } from "../../../src/domain/learning-state/gap-projection";
import { recordPracticeEvaluation } from "../../../src/domain/learning-state/transitions";
import type { LearningState, LearningEvidence, KnowledgeGap } from "../../../src/domain/learning-state/types";

const gap: KnowledgeGap = { id: "gap", concept: "Race", reason: "Missing mutex",
  programId: "p", objectiveId: "o", criterionId: "o@1:criterion-1",
  status: "open", evidenceIds: ["x"] };
function ev(id: string, time: number, met: boolean, recall = false): LearningEvidence {
  return { id, type: "practice", scope: "learner", concept: "Race",
    source: "test", createdAt: time, outcome: met ? "correct" : "incorrect",
    programId: "p", objectiveId: "o", objectiveRevision: 1, assisted: false,
    taskKind: recall ? "recall" : "guided-practice",
    rubricResults: [{ criterion: "Mutex", criterionId: gap.criterionId, met, evidence: "answer" }] };
}

test("gap stays open on error, improves after independent correction, resolves after delayed recall", () => {
  const x = ev("x", 0, false), y = ev("y", 100, true), z = ev("z", 47_000_000, true, true);
  assert.equal(deriveGapStatus(gap, [x]), "open");
  assert.equal(deriveGapStatus(gap, [x, y]), "improving");
  assert.equal(deriveGapStatus(gap, [x, y, z]), "resolved");
  assert.equal(deriveGapStatus(gap, [x, y, z, ev("r", 50_000_000, false, true)]), "open");
});

test("assisted passing and single MCQ never resolve a criterion gap", () => {
  const x = ev("x", 0, false);
  const y = { ...ev("y", 10, true), assisted: true };
  const z = { ...ev("z", 47_000_000, true, true), assessmentCoverage: "single-item" as const };
  assert.equal(deriveGapStatus(gap, [x, y, z]), "improving");
});

test("committed v3 projection is idempotent and opens criterion-specific gaps", () => {
  const initial: LearningState = { version: 2, target: null, gaps: [], evidence: [] };
  const evaluation = { kind: "evaluation" as const, concept: "Race",
    outcome: "partial" as const, feedback: "Repair", misconceptions: [],
    objectiveRevision: 1, evaluator: "llm-review" as const,
    assistance: { highestHintLevel: 0 as const, independent: true },
    rubricResults: [{ criterion: "Mutex", criterionId: gap.criterionId, met: false, evidence: "missing" }],
  };
  const once = recordPracticeEvaluation(initial, {
    evaluation, source: "q", evidenceId: "e", programId: "p", objectiveId: "o",
    questionId: "q-1",
  }, { now: () => 50, uuid: () => "new-gap" });
  const twice = recordPracticeEvaluation(once, {
    evaluation, source: "q", evidenceId: "e", programId: "p", objectiveId: "o",
    questionId: "q-1",
  }, { now: () => 50, uuid: () => "new-gap" });
  assert.equal(once.version, 3);
  assert.equal(once.evidence[0]?.evidenceVersion, 3);
  assert.equal(once.gaps[0]?.criterionId, gap.criterionId);
  assert.deepEqual(twice, once);
});
