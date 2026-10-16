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


test("four progressively acknowledged hints increase assistance without leaking a fifth", () => {
  const machine = new PracticeStateMachine(ids());
  const hints = ["Look for boundaries", "Find an invariant",
    "Compare two transactions", "Explain one violating interleaving"];
  machine.start();
  machine.acceptQuestion({ kind: "question", concept: "isolation",
    question: "Explain serializability", hints }, "question-progressive");
  assert.equal(machine.peekHint(), hints[0]);
  for (let index = 0; index < hints.length; index++) {
    assert.equal(machine.peekHint(), hints[index]);
    assert.equal(machine.markHintUsed(), hints[index]);
    assert.equal(machine.snapshot()?.turns.at(-1)?.highestHintLevel, index + 1);
  }
  assert.equal(machine.peekHint(), undefined);
  assert.equal(machine.markHintUsed(), undefined);
  const attempt = machine.beginEvaluation("My reasoning");
  assert.equal(attempt?.highestHintLevel, 4);
  assert.equal(attempt?.assisted, true);
});

test("legacy single hints remain one-level and independent answers remain level zero", () => {
  const machine = new PracticeStateMachine(ids());
  machine.start();
  machine.acceptQuestion({ kind: "question", concept: "HTTP",
    question: "Define idempotency", hint: "Think about retries" }, "legacy-q");
  assert.equal(machine.markHintUsed(), "Think about retries");
  assert.equal(machine.markHintUsed(), undefined);
  assert.equal(machine.beginEvaluation("Same output")?.highestHintLevel, 1);
  const independent = new PracticeStateMachine(ids());
  independent.start();
  independent.acceptQuestion({ kind: "question", concept: "HTTP",
    question: "Define idempotency" }, "clean-q");
  assert.equal(independent.beginEvaluation("Same output")?.highestHintLevel, 0);
});
