import assert from "node:assert/strict";
import test from "node:test";
import { PracticeStateMachine } from "../../../packages/core/src/domain/practice/PracticeStateMachine";

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

test("hint inspection is pure; only acknowledged intent marks a practice attempt assisted", () => {
  const machine = new PracticeStateMachine(ids());
  machine.start();
  machine.acceptQuestion({
    kind: "question", concept: "isolation", question: "What is serializable?",
    hint: "Consider every interleaving.",
  }, "question-1");

  assert.equal(machine.peekHint(), "Consider every interleaving.");
  assert.equal(machine.peekHint(), "Consider every interleaving.");
  assert.equal(machine.snapshot()?.turns[0].assisted, undefined);

  assert.equal(machine.markHintUsed(), "Consider every interleaving.");
  const attempt = machine.beginEvaluation("One serial order.");
  assert.equal(attempt?.assisted, true);
  assert.equal(machine.peekHint(), undefined, "no help can be requested while evaluating");
});


test("hint levels are monotone per question and reset for the next question", () => {
  const machine = new PracticeStateMachine(ids());
  machine.start();
  machine.acceptQuestion({ kind: "question", concept: "locking",
    question: "How?", hint: "Start with mutex.", objectiveRevision: 4 }, "qid");
  machine.markHintUsed(3);
  machine.markHintUsed(1);
  const first = machine.beginEvaluation("test");
  assert.equal(first?.highestHintLevel, 3);
  assert.equal(first?.objectiveRevision, 4);
  assert.equal(first?.questionId, "qid");
  assert.equal(first?.assisted, true);
  machine.commitEvaluation(first!, { kind: "evaluation", concept: "locking",
    outcome: "partial", feedback: "retry", misconceptions: [], nextQuestion: "Another?" });
  const second = machine.beginEvaluation("second");
  assert.equal(second?.highestHintLevel, 0);
});

test("M0 focus identity and M1 rubric revision survive into the same evaluated attempt", () => {
  const machine = new PracticeStateMachine(ids());
  machine.start();
  machine.acceptQuestion({
    kind: "question", concept: "concurrency", question: "Explain lock ordering",
    programId: "program-a", objectiveId: "locking",
    focusSessionId: "focus-123", objectiveRevision: 7,
    hint: "Think about cycles in the wait-for graph.",
  }, "question-123");
  machine.markHintUsed(2);
  const attempt = machine.beginEvaluation("Avoid circular waits");
  assert.ok(attempt);
  assert.equal(attempt.focusSessionId, "focus-123");
  assert.equal(attempt.objectiveRevision, 7);
  assert.equal(attempt.highestHintLevel, 2);
  assert.equal(attempt.questionId, "question-123");
  assert.equal(attempt.programId, "program-a");
  assert.equal(attempt.objectiveId, "locking");
  machine.rollbackEvaluation(attempt);
  const retry = machine.beginEvaluation("Order locks deterministically");
  assert.equal(retry?.focusSessionId, "focus-123");
  assert.equal(retry?.highestHintLevel, 2);
  assert.equal(retry?.objectiveRevision, 7);
});

test("clarification keeps the same question and marks later evaluation assisted", () => {
  const machine = new PracticeStateMachine(ids());
  machine.start();
  machine.acceptQuestion({ kind: "question", concept: "database",
    question: "Why isolation?", programId: "program" }, "question-1");
  machine.markClarificationUsed();
  assert.equal(machine.snapshot()?.state, "waiting-answer");
  const attempt = machine.beginEvaluation("Transactions stay isolated.");
  assert.equal(attempt?.questionId, "question-1");
  assert.equal(attempt?.assisted, true);
  assert.equal(attempt?.highestHintLevel, 1);
});
