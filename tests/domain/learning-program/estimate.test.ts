import assert from "node:assert/strict";
import test from "node:test";
import type { LearningEvidence } from "../../../src/domain/learning-state/types";
import type { LearningProgram } from "../../../src/domain/learning-program/types";
import { estimateRemainingWork } from "../../../src/domain/learning-program/estimate";

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 14);
const objectives = ["a", "b", "c", "d"].map(id => ({
  id, title: id, outcome: "Demonstrate "+id, prerequisiteIds: [],
  estimatedMinutes: 60, rubric: ["Explain"], sourceRefs: [],
  priority: "core" as const,
}));
const program: LearningProgram = {
  version: 1, id: "goal", goal: "Learn", planVersion: 1,
  createdAt: now - 3 * DAY,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourcePaths: [], sourceBound: false, excludedTopics: [] },
  objectives,
  sessionHistory: [{
    startedAt: now - DAY, endedAt: now - DAY + 10_000,
    minutesSpent: 200,
    objectiveActiveMinutes: { a: 90, b: 90, c: 90 },
  }],
};
function evidenceFor(id: string, at: number): LearningEvidence {
  return { id: id + at, programId: "goal", objectiveId: id, type: "practice",
    scope: "learner", concept: id, source: "note.md", outcome: "correct",
    assisted: false, createdAt: at,
    taskKind: at === now ? "recall" : "guided-practice",
    rubricResults: [{ criterion: "Explain", met: true, evidence: "Independent explanation" }],
  };
}
const evidence = ["a","b","c"].flatMap(id => [
  evidenceFor(id, now - 2 * DAY), evidenceFor(id, now),
  { ...evidenceFor(id, now), id: "transfer:" + id, taskKind: "transfer" as const },
]);
test("personalizes remaining work only from completed evidence and three measured objectives", () => {
  const estimate = estimateRemainingWork(program, evidence, now);
  assert.equal(estimate.basis, "calibrated");
  assert.equal(estimate.samples, 3);
  assert.equal(estimate.adjustment, 1.5);
  assert.equal(estimate.minutes, 126);
});
test("unmeasured history is never treated as calibrated learner pace", () => {
  const estimate = estimateRemainingWork({ ...program, sessionHistory: [] }, evidence, now);
  assert.equal(estimate.basis, "initial");
  assert.equal(estimate.minutes, 84);
});
