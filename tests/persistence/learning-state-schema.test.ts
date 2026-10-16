import assert from "node:assert/strict";
import test from "node:test";
import { decodeLearningState } from "../../src/persistence/learning-state-schema";

test("rejects malformed nested learning state", () => {
  assert.throws(
    () =>
      decodeLearningState({
        version: 1,
        target: null,
        gaps: [{}],
        evidence: [123],
      }),
    /unsupported shape/,
  );
});

test("migrates review evidence to material scope and removes review-only learner gaps", () => {
  const migrated = decodeLearningState({
    version: 1,
    target: null,
    gaps: [
      {
        id: "gap-review",
        concept: "MVCC",
        reason: "note omits visibility rules",
        evidenceIds: ["review-1"],
        status: "open",
      },
      {
        id: "gap-practice",
        concept: "indexes",
        reason: "missed left-most prefix",
        evidenceIds: ["practice-1"],
        status: "open",
      },
    ],
    evidence: [
      {
        id: "review-1",
        type: "review",
        concept: "MVCC",
        source: "note.md",
        outcome: "missing-relation",
        createdAt: 1,
      },
      {
        id: "practice-1",
        type: "practice",
        concept: "indexes",
        source: "note.md",
        outcome: "partial",
        createdAt: 2,
      },
    ],
  });

  assert.equal(migrated.version, 3);
  assert.deepEqual(
    migrated.evidence.map((item) => [item.id, item.scope]),
    [
      ["review-1", "material"],
      ["practice-1", "learner"],
    ],
  );
  assert.deepEqual(
    migrated.gaps.map((gap) => gap.id),
    ["gap-practice"],
  );
});

test("accepts a valid v2 state and returns detached arrays", () => {
  const source = {
    version: 2 as const,
    target: null,
    gaps: [
      {
        id: "gap-1",
        concept: "indexes",
        reason: "reason",
        evidenceIds: ["e-1"],
        status: "open" as const,
      },
    ],
    evidence: [
      {
        id: "e-1",
        type: "practice" as const,
        scope: "learner" as const,
        concept: "indexes",
        source: "note.md",
        createdAt: 1,
      },
    ],
  };

  const decoded = decodeLearningState(source);
  decoded.gaps[0].evidenceIds.push("e-2");

  assert.deepEqual(source.gaps[0].evidenceIds, ["e-1"]);
});
