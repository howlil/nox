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
