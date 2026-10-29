import assert from "node:assert/strict";
import test from "node:test";
import { isPracticeQuestion, validatePracticeAnswer, gradeMultipleChoice } from "../../../packages/core/src/domain/practice/question-schema";
import type { PracticeQuestion } from "../../../src/domain/practice/types";
import { PracticeStateMachine } from "../../../packages/core/src/domain/practice/PracticeStateMachine";

const mcq: PracticeQuestion = {
  kind: "question", concept: "IoC", question: "Who owns dependencies?",
  input: { type: "multiple-choice", options: [
    { id: "a", text: "Application" }, { id: "b", text: "Container" },
  ], correctOptionId: "b", explanation: "IoC transfers dependency creation to the container." },
};
const essay: PracticeQuestion = {
  kind: "question", concept: "Isolation", question: "Explain isolation.",
  input: { type: "essay", criteria: ["Describe anomaly prevention"] },
};
const code: PracticeQuestion = {
  kind: "question", concept: "DI", question: "Write constructor injection.",
  input: { type: "code", language: "java", starterCode: "class Service {}",
    criteria: ["Accept dependency through constructor"], executionMode: "review-only" },
};

test("question schema accepts old practice and typed MCQ/essay/code", () => {
  assert.equal(isPracticeQuestion({ kind: "question", concept: "x", question: "Explain x." }), true);
  for (const q of [mcq, essay, code]) assert.equal(isPracticeQuestion(q), true);
});

test("schema rejects answer keys pointing to nonexistent or duplicate options", () => {
  assert.equal(isPracticeQuestion({ ...mcq, input: {
    ...mcq.input, correctOptionId: "missing",
  } }), false);
  assert.equal(isPracticeQuestion({ ...mcq, input: {
    type: "multiple-choice", correctOptionId: "a", explanation: "reason",
    options: [{ id: "a", text: "One" }, { id: "a", text: "Two" }],
  } }), false);
  assert.equal(isPracticeQuestion({ ...code, input: {
    ...code.input, executionMode: "execute",
  } }), false);
});

test("typed answer validation does not accept mismatched form or wrong code language", () => {
  assert.throws(() => validatePracticeAnswer(mcq, { type: "essay", text: "b" }));
  assert.throws(() => validatePracticeAnswer(mcq, { type: "multiple-choice", optionId: "absent" }));
  assert.throws(() => validatePracticeAnswer(code, { type: "code", language: "python", source: "print(1)" }));
  assert.equal(validatePracticeAnswer(essay, { type: "essay", text: "ACID isolation." }), "ACID isolation.");
  assert.equal(validatePracticeAnswer(code, { type: "code", language: "java", source: "class Service {}" }),
    "class Service {}");
});

test("MCQ grader returns stable verdict independent of AI and never auto-selects answer", () => {
  assert.equal(gradeMultipleChoice(mcq, { type: "multiple-choice", optionId: "b" }).outcome, "correct");
  const bad = gradeMultipleChoice(mcq, { type: "multiple-choice", optionId: "a" });
  assert.equal(bad.outcome, "incorrect");
  assert.ok(bad.misconceptions.length);
  assert.equal(bad.feedback, mcq.input?.type === "multiple-choice" ? mcq.input.explanation : "");
});

test("PracticeStateMachine retains the typed question spec across answer/evaluation", () => {
  const sm = new PracticeStateMachine(() => "stable-id");
  sm.start();
  sm.acceptQuestion(code, "question-1");
  const attempt = sm.beginEvaluation("class Service { Service(Repo r) {} }");
  assert.equal(attempt?.questionId, "question-1");
  assert.deepEqual(attempt?.questionSpec?.input, code.input);
  assert.equal(sm.isWaitingForAnswer(), false);
  sm.rollbackEvaluation(attempt!);
  assert.equal(sm.isWaitingForAnswer(), true);
});
