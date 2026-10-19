import assert from "node:assert/strict";
import test from "node:test";
import { StructuredTurnBuffer } from "../../src/application/StructuredTurnBuffer";
import { InvalidLearningOutputError } from "../../src/application/turn-output-error";
import type { LearningRequest } from "../../src/application/learning-types";
import type { TurnContextSnapshot } from "../../src/context/context-types";

const snapshot: TurnContextSnapshot = {
  resolved: { explicit: [] },
  visible: [],
  system: [],
  readableFiles: [],
  mutableFile: "notes/source.md",
};
const request = (action: LearningRequest["action"]): LearningRequest => ({
  prompt: "test", action, explicitContext: [], turnId: "turn-1",
});

test("plain text/thought stream remains incremental while structured results are only buffered", () => {
  const buffer = new StructuredTurnBuffer(request("review"), snapshot);
  const findings = [{ kind: "weak-explanation" as const, concept: "CAP",
    title: "Missing tradeoff", detail: "Explain partition tolerance." }];
  assert.deepEqual([...buffer.map([
    { type: "text", text: "A" }, { type: "thought", text: "T" },
    { type: "review-findings", findings },
    { type: "text", text: "B" },
  ])], [
    { type: "response-delta", text: "A" },
    { type: "thought-delta", text: "T" },
    { type: "response-delta", text: "B" },
  ]);
  assert.deepEqual(buffer.reviewBuffer, { observed: true, findings });
});

test("a duplicate review payload is rejected without creating a second candidate", () => {
  const buffer = new StructuredTurnBuffer(request("review"), snapshot);
  assert.deepEqual([...buffer.map([{ type: "review-findings", findings: [] }])], []);
  assert.throws(() => [...buffer.map([{ type: "review-findings", findings: [] }])],
    InvalidLearningOutputError);
  assert.equal(buffer.reviewBuffer.observed, true);
});

test("edit proposals require the mutable active note and a single proposal", () => {
  const buffer = new StructuredTurnBuffer(request("edit"), snapshot);
  const allowed = { file: "notes/source.md", original: "old", replacement: "new" };
  assert.throws(() => [...buffer.map([{ type: "proposal",
    proposal: { ...allowed, file: "notes/other.md" } }])], InvalidLearningOutputError);
  assert.equal(buffer.proposalBuffer.proposal, undefined);
  assert.deepEqual([...buffer.map([{ type: "proposal", proposal: allowed }])], []);
  assert.deepEqual(buffer.proposalBuffer.proposal, allowed);
  assert.throws(() => [...buffer.map([{ type: "proposal", proposal: allowed }])],
    InvalidLearningOutputError);
});

test("practice candidates cannot become visible before terminal commit", () => {
  const buffer = new StructuredTurnBuffer(request("practice"), snapshot);
  const question = { kind: "question" as const, concept: "Concurrency", question: "What is a race?" };
  assert.deepEqual([...buffer.map([{ type: "practice-question", question }])], []);
  assert.deepEqual(buffer.practiceBuffer.question, question);
  assert.throws(() => [...buffer.map([{ type: "practice-question", question }])],
    InvalidLearningOutputError);
  assert.throws(() => [...buffer.map([{ type: "practice-evaluation", evaluation: {
    kind: "evaluation", concept: "Concurrency", outcome: "correct",
    feedback: "Correct", misconceptions: [],
  } }])], InvalidLearningOutputError);
});

test("scope decision and malformed parser output are rejected outside scoped practice", () => {
  const buffer = new StructuredTurnBuffer(request("ask"), snapshot);
  assert.throws(() => [...buffer.map([{ type: "scope-decision", outcome: "answer" }])],
    InvalidLearningOutputError);
  assert.throws(() => [...buffer.map([{ type: "error", message: "broken payload" }])],
    /broken payload/);
});
