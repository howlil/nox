import assert from "node:assert/strict";
import test from "node:test";
import { attachAssessmentProvenance } from "../../src/application/assessment-provenance";
import type { PracticeEvaluationAttempt } from "../../src/domain/practice/PracticeStateMachine";
import type { LearningProgram } from "../../src/domain/learning-program/types";
import type { PracticeEvaluation } from "../../src/domain/practice/types";

const program: LearningProgram = {
  version: 1, id: "program", goal: "Concurrency", planVersion: 2,
  createdAt: 100, constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourcePaths: [], sourceBound: false, excludedTopics: [] },
  objectives: [{ id: "locks", title: "Locking", outcome: "Explain locking",
    prerequisiteIds: [], estimatedMinutes: 45,
    rubric: ["Explain isolation"],
    criteria: [{ id: "stable-c7", description: "Explain isolation", required: true }],
    sourceRefs: [], priority: "core" }],
};
const attempt: PracticeEvaluationAttempt = {
  id: "attempt", sessionId: "chat", questionId: "question",
  question: "What is isolation?", answer: "My answer",
  programId: "program", objectiveId: "locks", assisted: true,
  highestHintLevel: 1, taskKind: "recall",
  questionSpec: { kind: "question", question: "What is isolation?",
    concept: "Locking", focusSessionId: "focus-1" },
};
const evaluated: PracticeEvaluation = {
  kind: "evaluation", concept: "Locking", outcome: "correct",
  feedback: "Correct", misconceptions: [], evaluator: "verified-execution",
  assistance: { highestHintLevel: 0, independent: true },
  rubricResults: [{ criterion: "Explain isolation", criterionId: "fake-id",
    met: true, evidence: "Answer demonstrates isolation" }],
};
test("provider may not forge assessor authority, independent status or criterion identity", () => {
  const actual = attachAssessmentProvenance(evaluated, attempt, program, "llm-review");
  assert.equal(actual.evaluator, "llm-review");
  assert.deepEqual(actual.assistance, { highestHintLevel: 1, independent: false });
  assert.equal(actual.assisted, true);
  assert.equal(actual.objectiveRevision, 2);
  assert.equal(actual.focusSessionId, "focus-1");
  assert.equal(actual.rubricResults?.[0].criterionId, "stable-c7");
  assert.equal(actual.taskKind, "recall");
});
test("deterministic multiple-choice still records assistance and cannot claim full coverage", () => {
  const actual = attachAssessmentProvenance({
    ...evaluated, assessmentCoverage: "single-item",
  }, { ...attempt, highestHintLevel: 0, assisted: false }, program, "deterministic");
  assert.equal(actual.evaluator, "deterministic");
  assert.deepEqual(actual.assistance, { highestHintLevel: 0, independent: true });
  assert.equal(actual.assessmentCoverage, "single-item");
});
test("question from another program is not attributed to current program", () => {
  assert.throws(() => attachAssessmentProvenance(evaluated,
    { ...attempt, programId: "other" }, program, "llm-review"),
    /missing learning objective/);
});


test("application cannot mint verified execution without a sandbox receipt", () => {
  assert.throws(() => attachAssessmentProvenance(evaluated, attempt,
    program, "verified-execution" as never), /trusted sandbox receipt/);
});
