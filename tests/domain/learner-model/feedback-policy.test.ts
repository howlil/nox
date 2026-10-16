import assert from "node:assert/strict";
import test from "node:test";
import { decideFeedback } from "../../../src/domain/learner-model/feedback-policy";
import type { LearningObjective } from "../../../src/domain/learning-program/types";
import type { LearningEvidence } from "../../../src/domain/learning-state/types";

const objective: LearningObjective = {
  id: "a", title: "Transactions", outcome: "Explain isolation",
  prerequisiteIds: [], estimatedMinutes: 40,
  rubric: ["Explain isolation", "Identify races"], sourceRefs: [], priority: "core",
};
function attempt(id: string, outcome: string, failed: string[] = []): LearningEvidence {
  return {
    id, type: "practice", scope: "learner", programId: "p", objectiveId: "a",
    concept: "Isolation", source: "lesson.md", outcome, createdAt: Number(id),
    taskKind: "guided-practice",
    rubricResults: objective.rubric.map(criterion => ({
      criterion, met: !failed.includes(criterion), evidence: "Checked",
    })),
  };
}
test("one missed criterion asks for correction, not all material", () => {
  const first = attempt("1", "partial", ["Identify races"]);
  assert.deepEqual(decideFeedback(objective, [first], first), {
    kind: "repair", failedCriteria: ["Identify races"], evidenceIds: ["1"],
  });
});
test("a repeated criterion failure escalates to bounded scaffold", () => {
  const first = attempt("1", "incorrect", ["Identify races"]);
  const second = attempt("2", "partial", ["Identify races"]);
  assert.deepEqual(decideFeedback(objective, [first, second], second), {
    kind: "scaffold", level: 2, failedCriteria: ["Identify races"], evidenceIds: ["1", "2"],
  });
});
test("hint assisted success requires independent variation", () => {
  const first = { ...attempt("1", "correct"), assisted: true };
  assert.equal(decideFeedback(objective, [first], first).kind, "independent-check");
  const clean = attempt("2", "correct");
  assert.equal(decideFeedback(objective, [clean], clean).kind, "delayed-recall");
});
 
test("scaffolding increases only for distinct failed questions and resets after independent repair", () => {
  const original = attempt("1", "incorrect", ["Identify races"]);
  const duplicated = { ...attempt("2", "partial", ["Identify races"]), questionId: "same" };
  const duplicatedOther = { ...attempt("3", "incorrect", ["Identify races"]),
    questionId: "same" };
  assert.equal(decideFeedback(objective, [original, duplicated, duplicatedOther],
    duplicatedOther).kind, "scaffold");
  const first = { ...original, questionId: "q1" };
  const second = { ...duplicated, questionId: "q2" };
  const third = { ...duplicatedOther, questionId: "q3" };
  assert.deepEqual(decideFeedback(objective, [first, second, third], third), {
    kind: "scaffold", level: 3, failedCriteria: ["Identify races"],
    evidenceIds: ["2", "3"],
  });
  const recovered = { ...attempt("4", "correct"), questionId: "q4" };
  const newFailure = { ...attempt("5", "incorrect", ["Identify races"]), questionId: "q5" };
  assert.equal(decideFeedback(objective, [first, second, third, recovered, newFailure],
    newFailure).kind, "repair");
  assert.equal(decideFeedback(objective, [first, second], second,
    { scaffoldAfterFailures: 3 }).kind, "repair");
});

test("revisioned evidence matches stable criterion IDs, not stale rubric prose", () => {
  const updated: LearningObjective = { ...objective,
    rubric: ["Explain transaction isolation", "Identify concurrency races"],
    criteria: [
      { id: "c1", description: "Explain transaction isolation", required: true },
      { id: "c2", description: "Identify concurrency races", required: true },
    ],
  };
  const current = { ...attempt("1", "incorrect", ["Identify races"]),
    objectiveRevision: 2, rubricResults: [
      { criterion: "Explain isolation", criterionId: "c1", met: true, evidence: "yes" },
      { criterion: "Identify races", criterionId: "c2", met: false, evidence: "missed" },
    ],
  };
  assert.deepEqual(decideFeedback(updated, [current], current).failedCriteria,
    ["Identify concurrency races"]);
});
