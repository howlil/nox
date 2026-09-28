import assert from "node:assert/strict";
import test from "node:test";
import {
  recordPracticeEvaluation,
  recordReviewFindings,
} from "../../../src/domain/learning-state/transitions";
import { LearningState } from "../../../src/learning/learning-state";

function baseState(): LearningState {
  return {
    version: 2,
    target: null,
    gaps: [],
    evidence: [],
  };
}

function deps() {
  let id = 0;
  return {
    now: () => 100,
    uuid: () => `id-${++id}`,
  };
}

test("review findings create material evidence without learner gaps", () => {
  const current = baseState();

  const next = recordReviewFindings(
    current,
    {
      source: "note.md",
      findings: [
        {
          kind: "missing-relation",
          concept: "MVCC",
          title: "Missing visibility relationship",
          detail: "The note omits snapshot visibility rules.",
        },
      ],
    },
    deps(),
  );

  assert.equal(current.evidence.length, 0);
  assert.equal(next.gaps.length, 0);
  assert.equal(next.evidence.length, 1);
  assert.equal(next.evidence[0]?.type, "review");
  assert.equal(next.evidence[0]?.scope, "material");
  assert.equal(next.currentTopic, "MVCC");
});

test("practice misconception creates learner evidence and an open gap", () => {
  const current = baseState();

  const next = recordPracticeEvaluation(
    current,
    {
      source: "indexes.md",
      evaluation: {
        kind: "evaluation",
        concept: "Composite indexes",
        outcome: "partial",
        feedback: "Direction is right.",
        misconceptions: ["Missed left-most prefix"],
      },
    },
    deps(),
  );

  assert.equal(current.gaps.length, 0);
  assert.equal(next.evidence[0]?.scope, "learner");
  assert.equal(next.gaps.length, 1);
  assert.equal(next.gaps[0]?.status, "open");
  assert.equal(next.gaps[0]?.reason, "Missed left-most prefix");
});

test("one correct answer moves an open learner gap to improving", () => {
  const first = recordPracticeEvaluation(
    baseState(),
    {
      source: "indexes.md",
      evaluation: {
        kind: "evaluation",
        concept: "Composite indexes",
        outcome: "partial",
        feedback: "Missing one relationship.",
        misconceptions: ["Missed left-most prefix"],
      },
    },
    deps(),
  );

  const next = recordPracticeEvaluation(
    first,
    {
      source: "indexes.md",
      evaluation: {
        kind: "evaluation",
        concept: "Composite indexes",
        outcome: "correct",
        feedback: "Correct.",
        misconceptions: [],
      },
    },
    {
      now: () => 200,
      uuid: () => "correct-evidence",
    },
  );

  assert.equal(first.gaps[0]?.status, "open");
  assert.equal(next.gaps[0]?.status, "improving");
  assert.equal(next.gaps[0]?.evidenceIds.length, 2);
});

test("existing caller state is not mutated", () => {
  const current = baseState();
  current.gaps.push({
    id: "gap-1",
    concept: "Indexes",
    reason: "Ordering",
    evidenceIds: ["old"],
    status: "open",
  });

  const next = recordPracticeEvaluation(
    current,
    {
      source: "indexes.md",
      evaluation: {
        kind: "evaluation",
        concept: "Indexes",
        outcome: "correct",
        feedback: "Correct.",
        misconceptions: [],
      },
    },
    {
      now: () => 200,
      uuid: () => "new",
    },
  );

  assert.equal(current.gaps[0]?.status, "open");
  assert.deepEqual(current.gaps[0]?.evidenceIds, ["old"]);
  assert.equal(next.gaps[0]?.status, "improving");
});
