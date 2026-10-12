import assert from "node:assert/strict";
import test from "node:test";
import { PracticeStateMachine } from "../../../src/domain/practice/PracticeStateMachine";

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

test("practice moves generating -> waiting -> evaluating -> complete", () => {
  const machine = new PracticeStateMachine(ids());

  machine.start();
  machine.acceptQuestion({
    kind: "question",
    concept: "indexes",
    question: "Why does order matter?",
  });

  assert.equal(machine.snapshot()?.state, "waiting-answer");

  const attempt = machine.beginEvaluation("Because of ordering");
  assert.ok(attempt);
  assert.equal(machine.snapshot()?.state, "evaluating");

  const next = machine.commitEvaluation(attempt, {
    kind: "evaluation",
    concept: "indexes",
    outcome: "correct",
    feedback: "Good",
    misconceptions: [],
  });

  assert.equal(next, undefined);
  assert.equal(machine.snapshot()?.state, "complete");
  assert.equal(machine.snapshot()?.turns[0]?.answer, "Because of ordering");
});

test("failed evaluation can roll back to the same active question", () => {
  const machine = new PracticeStateMachine(ids());

  machine.start();
  machine.acceptQuestion({
    kind: "question",
    concept: "transactions",
    question: "What makes a transaction atomic?",
  });

  const attempt = machine.beginEvaluation("first answer");
  assert.ok(attempt);

  machine.rollbackEvaluation(attempt);

  assert.equal(machine.snapshot()?.state, "waiting-answer");
  assert.equal(
    machine.snapshot()?.currentQuestion,
    "What makes a transaction atomic?",
  );

  const retry = machine.beginEvaluation("retry answer");
  assert.ok(retry);
  assert.equal(retry.question, attempt.question);
});

test("evaluation with a next question keeps practice active", () => {
  const machine = new PracticeStateMachine(ids());

  machine.start();
  machine.acceptQuestion({
    kind: "question",
    concept: "indexes",
    question: "Question one?",
  });

  const attempt = machine.beginEvaluation("answer");
  assert.ok(attempt);

  const next = machine.commitEvaluation(attempt, {
    kind: "evaluation",
    concept: "indexes",
    outcome: "partial",
    feedback: "Keep going",
    misconceptions: ["left-most prefix"],
    nextQuestion: "Question two?",
  });

  assert.deepEqual(next, {
    kind: "question",
    concept: "indexes",
    question: "Question two?",
  });
  assert.equal(machine.snapshot()?.state, "waiting-answer");
  assert.equal(machine.snapshot()?.currentQuestion, "Question two?");
  assert.equal(machine.snapshot()?.turns.length, 2);
});

test("reset removes the active practice session", () => {
  const machine = new PracticeStateMachine(ids());
  machine.start();
  machine.reset();

  assert.equal(machine.snapshot(), null);
  assert.equal(machine.beginEvaluation("answer"), null);
});

test("a practice question retains its source and question id during evaluation", () => {
  const machine = new PracticeStateMachine(ids());
  machine.start({ file: "original.md", selectedText: "isolation" });
  machine.acceptQuestion({
    kind: "question", concept: "isolation", question: "Define isolation?",
  }, "durable-question");
  const attempt = machine.beginEvaluation("An answer");
  assert.equal(attempt?.origin?.file, "original.md");
  assert.equal(attempt?.origin?.selectedText, "isolation");
  assert.equal(attempt?.questionId, "durable-question");
});
