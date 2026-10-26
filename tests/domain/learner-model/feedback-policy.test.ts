import assert from "node:assert/strict";
import test from "node:test";
import { criterionIdFor, decideFeedback } from "../../../packages/core/src/domain/learner-model/feedback-policy";
import type { LearningObjective } from "../../../packages/core/src/domain/learning-program/types";
import type { LearningEvidence } from "../../../packages/core/src/domain/learning-state/types";

const objective: LearningObjective = {
  id: "obj", title: "Race conditions", outcome: "Prevent duplicate work",
  prerequisiteIds: [], estimatedMinutes: 10, rubric: ["Identify race", "Prevent race"],
  sourceRefs: [], priority: "core",
};
const firstCriterion = criterionIdFor("obj", 1, 0);
const secondCriterion = criterionIdFor("obj", 1, 1);
function attempt(id: string, at: number, outcome: "correct" | "partial" | "incorrect",
  other: Partial<LearningEvidence> = {}): LearningEvidence {
  return {
    id, type: "practice", scope: "learner", concept: "Race", source: "unit",
    outcome, createdAt: at, programId: "p", objectiveId: "obj",
    objectiveRevision: 1, questionId: id, evidenceVersion: 3,
    evaluator: "llm-review", assistance: { highestHintLevel: 0, independent: true },
    rubricResults: [
      { criterion: "Identify race", criterionId: firstCriterion, met: outcome === "correct", evidence: "proof" },
      { criterion: "Prevent race", criterionId: secondCriterion, met: outcome === "correct", evidence: "proof" },
    ], ...other,
  };
}

test("partial feedback names specific failed criteria rather than repeating the whole objective", () => {
  const x = attempt("a", 0, "partial", { rubricResults: [
    { criterion: "Identify race", criterionId: firstCriterion, met: true, evidence: "identified" },
    { criterion: "Prevent race", criterionId: secondCriterion, met: false, evidence: "missing" },
  ] });
  assert.deepEqual(decideFeedback(objective, [x], x), { kind: "repair", failedCriterionIds: [secondCriterion] });
});

test("repeated failure provides bounded scaffolding", () => {
  const a = attempt("a", 0, "incorrect"), b = attempt("b", 100, "incorrect");
  assert.deepEqual(decideFeedback(objective, [a, b], b), {
    kind: "scaffold", level: 2, failedCriterionIds: [firstCriterion, secondCriterion],
  });
});

test("assisted correct answer must be checked independently", () => {
  const a = attempt("a", 10, "correct", {
    assistance: { highestHintLevel: 2, independent: false }, assisted: true,
  });
  assert.deepEqual(decideFeedback(objective, [a], a), { kind: "independent-check" });
});

test("a single independent success cannot establish mastery", () => {
  const a = attempt("a", 0, "correct");
  assert.deepEqual(decideFeedback(objective, [a], a), {
    kind: "delayed-recall", dueAt: 12 * 60 * 60 * 1000,
  });
});

test("independent recall after separation can prove readiness", () => {
  const a = attempt("a", 0, "correct");
  const b = attempt("b", 13 * 60 * 60 * 1000, "correct", { taskKind: "recall" });
  assert.deepEqual(decideFeedback(objective, [a, b], b), { kind: "ready-to-advance" });
});

test("evidence never leaks between programs with the same objective ID", () => {
  const a = attempt("a", 0, "correct", { programId: "other" });
  const b = attempt("b", 13 * 60 * 60 * 1000, "correct", { taskKind: "recall" });
  assert.equal(decideFeedback(objective, [a, b], b).kind, "delayed-recall");
});


test("failed recall resets the readiness cycle even if a previous cycle passed", () => {
  const initial = attempt("a", 0, "correct");
  const recall = attempt("b", 47_000_000, "correct", { taskKind: "recall" });
  const regression = attempt("c", 48_000_000, "incorrect", { taskKind: "recall" });
  const correction = attempt("d", 49_000_000, "correct");
  assert.equal(decideFeedback(objective, [initial, recall], recall).kind, "ready-to-advance");
  assert.equal(decideFeedback(objective, [initial, recall, regression, correction], correction).kind,
    "delayed-recall");
});
