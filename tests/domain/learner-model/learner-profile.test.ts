import assert from "node:assert/strict";
import test from "node:test";
import { deriveLearnerProfile, toLearnerProfileContext } from "../../../packages/core/src/domain/learner-model/learner-profile";
import type { LearningProgram } from "../../../packages/core/src/domain/learning-program/types";
import type { LearningState, LearningEvidence } from "../../../packages/core/src/domain/learning-state/types";

function program(revision = 1): LearningProgram {
  return { version: 2, id: "p", goal: "Concurrency", createdAt: 0, planVersion: revision,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourcePaths: [],
      sourceBound: false, excludedTopics: [] },
    objectives: [
      { id: "locks", title: "Locks", outcome: "Explain lock ordering",
        prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain ordering"],
        sourceRefs: [], priority: "core", objectiveRevision: revision },
      { id: "done", title: "Historical", outcome: "Ignored",
        prerequisiteIds: [], estimatedMinutes: 20, rubric: ["Historical"],
        sourceRefs: [], priority: "optional", deprecated: true },
    ] };
}
function entry(id: string, at: number, outcome: "correct" | "incorrect" = "correct",
  options: { revision?: number; hint?: number; scope?: "learner" | "material"; task?: "recall" | "guided-practice" } = {}): LearningEvidence {
  const revision = options.revision ?? 1;
  const hint = options.hint ?? 0;
  return { id, type: "practice", scope: options.scope ?? "learner", concept: "Locks",
    source: "note.md", createdAt: at, programId: "p", objectiveId: "locks",
    questionId: id, evidenceVersion: 3, objectiveRevision: revision, outcome,
    assisted: hint > 0, assistance: { highestHintLevel: hint as 0 | 1 | 2 | 3 | 4,
      independent: hint === 0 },
    taskKind: options.task ?? "guided-practice",
    rubricResults: [{ criterion: "Explain ordering", criterionId: `locks@${revision}:criterion-1`,
      met: outcome === "correct", evidence: "test" }],
  };
}
function state(evidence: LearningEvidence[]): LearningState {
  return { version: 3, target: null, gaps: [], evidence };
}
test("empty evidence stays unknown without fabricating learner traits", () => {
  const profile = deriveLearnerProfile(program(), state([]), 100);
  assert.equal(profile.objectives.length, 1);
  assert.equal(profile.objectives[0].status, "unseen");
  assert.equal(profile.objectives[0].criterion[0].status, "unknown");
  assert.equal(profile.evidenceCount, 0);
  assert.deepEqual(profile.evidenceIds, []);
  assert.equal("personality" in profile, false);
});
test("assisted success remains formative, independent answer then delayed recall verifies", () => {
  const assisted = entry("hinted", 10, "correct", { hint: 2 });
  assert.equal(deriveLearnerProfile(program(), state([assisted]), 50).objectives[0].criterion[0].status, "assisted");
  const corrected = entry("independent", 100);
  const provisional = deriveLearnerProfile(program(), state([assisted, corrected]), 200);
  assert.equal(provisional.objectives[0].criterion[0].status, "provisional");
  const recall = entry("recall", 13 * 3_600_000, "correct", { task: "recall" });
  const verified = deriveLearnerProfile(program(), state([assisted, corrected, recall]), recall.createdAt + 1);
  assert.equal(verified.objectives[0].criterion[0].status, "verified");
  const regressed = entry("failure", recall.createdAt + 2, "incorrect", { task: "recall" });
  assert.equal(deriveLearnerProfile(program(), state([assisted, corrected, recall, regressed]), regressed.createdAt + 1)
    .objectives[0].criterion[0].status, "needs-repair");
});
test("revised objectives ignore prior evidence and material review evidence", () => {
  const old = entry("old", 100);
  const otherScope = entry("review", 200, "correct", { revision: 2, scope: "material" });
  const projected = deriveLearnerProfile(program(2), state([old, otherScope]), 300);
  assert.equal(projected.objectives[0].status, "unseen");
  assert.equal(projected.objectives[0].criterion[0].status, "unknown");
  assert.equal(projected.objectives[0].recentEvidenceIds.length, 0);
});
test("projection is deterministic, bounded and cannot mutate source evidence", () => {
  const rows = Array.from({ length: 50 }, (_, i) => entry("e-"+i, i));
  const original = structuredClone(rows);
  const before = deriveLearnerProfile(program(), state(rows), 1_000);
  const again = deriveLearnerProfile(program(), state(rows), 1_000);
  assert.deepEqual(before, again);
  assert.deepEqual(rows, original);
  assert.equal(before.evidenceCount, 50);
  assert.equal(before.objectives[0].recentEvidenceIds.length, 8);
  assert.equal(toLearnerProfileContext(before).objectives[0].recentEvidenceIds.length, 4);
});
