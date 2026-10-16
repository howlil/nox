import assert from "node:assert/strict";
import test from "node:test";
import { buildLearningContext } from "../../src/application/learning-context-builder";
import { projectLearnerModel, selectRelevantLearnerState } from "../../src/domain/learner-model/learner-memory";
import type { LearningProgram } from "../../src/domain/learning-program/types";
import type { LearningEvidence } from "../../src/domain/learning-state/types";

const program: LearningProgram = {
  version: 1, id: "program", goal: "Learn SQL", createdAt: 1, planVersion: 2,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourcePaths: [], sourceBound: false, excludedTopics: [] },
  objectives: [{ id: "tx", title: "Transactions", outcome: "Explain ACID",
    estimatedMinutes: 45, rubric: ["Define atomicity"],
    criteria: [{ id: "c1", description: "Define atomicity", required: true }],
    prerequisiteIds: [], sourceRefs: [], priority: "core" }],
};
const evidence: LearningEvidence[] = Array.from({ length: 7 }, (_, i) => ({
  id: "e-" + i, type: "practice", scope: "learner", programId: "program",
  objectiveId: "tx", objectiveRevision: 2,
  concept: "Atomicity", source: "notes/acid.md",
  createdAt: 1 + i, outcome: i % 2 ? "incorrect" : "correct",
  rubricResults: [{ criterionId: "c1", criterion: "Define atomicity",
    met: i % 2 === 0, evidence: "Observed" }],
}));
const selected = () => selectRelevantLearnerState(program,
  projectLearnerModel(program, evidence), evidence, [], "tx");

test("learning context prioritizes authorized rubric, current question and targets", () => {
  const value = buildLearningContext({
    program, objective: program.objectives[0], memory: selected(),
    decision: { kind: "remediate", objective: program.objectives[0],
      targetCriterionIds: ["c1"], sourceEvidenceIds: ["e-1"], reason: "Fix the issue" },
    question: { questionId: "q1", assisted: true, highestHintLevel: 2 },
  });
  assert.equal(value.context.version, 1);
  assert.deepEqual(value.context.authority.rubric, [{
    id: "c1", description: "Define atomicity",
  }]);
  assert.deepEqual(value.context.activity.targetCriterionIds, ["c1"]);
  assert.equal(value.context.question?.highestHintLevel, 2);
  assert.match(value.serialized, /VERIFIED LEARNER CONTEXT/);
  assert.equal(value.shortened, false);
});

test("budget trims optional episodes before losing authoritative rubric", () => {
  const original = selected();
  const bloated = structuredClone(original);
  bloated.episodes = Array.from({ length: 30 }, (_, i) => ({
    evidenceId: "event-" + i + "x".repeat(300),
    objectiveId: "tx", createdAt: i, criterionIds: ["c1"], assisted: false,
    highestHintLevel: 0,
  }));
  const out = buildLearningContext({
    program, objective: program.objectives[0], memory: bloated, maxChars: 1800,
  });
  assert.equal(out.shortened, true);
  assert.ok(out.serialized.length <= 1800);
  assert.equal(out.context.authority.rubric[0].description, "Define atomicity");
  assert.ok(out.context.memory.episodes.length < 30);
  const huge = { ...program, goal: "X".repeat(4000) };
  assert.throws(() => buildLearningContext({
    program: huge, objective: huge.objectives[0], memory: bloated, maxChars: 1800,
  }), /rubric exceeds the context budget/);
});
test("context builder rejects forged objective and target criterion identities", () => {
  assert.throws(() => buildLearningContext({
    program, objective: program.objectives[0], memory: { ...selected(), objectiveId: "other" },
  }), /provenance/);
  assert.throws(() => buildLearningContext({
    program, objective: program.objectives[0], memory: selected(),
    decision: { kind: "recall", reason: "recheck", targetCriterionIds: ["not-in-rubric"] },
  }), /outside the objective/);
});
