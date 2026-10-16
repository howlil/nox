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
 
test("v2 to v3 retains historical evidence without invented criterion or evaluator metadata", () => {
  const migrated = decodeLearningState({
    version: 2, target: "SQL", gaps: [], evidence: [{
      id: "old", type: "practice", scope: "learner", concept: "Locks",
      source: "notes.md", outcome: "correct", createdAt: 100,
      rubricResults: [{ criterion: "Define locking", met: true, evidence: "Answer" }],
    }],
  });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.evidence[0].questionId, undefined);
  assert.equal(migrated.evidence[0].evaluator, undefined);
  assert.equal(migrated.evidence[0].assistance, undefined);
  assert.equal(migrated.evidence[0].rubricResults?.[0].criterionId, undefined);
});

test("v3 round-trips explicit criterion, question, evaluator and assistance provenance", () => {
  const original = {
    version: 3, target: null, gaps: [], evidence: [{
      id: "e-1", type: "practice", scope: "learner", concept: "Transactions",
      source: "db.md", createdAt: 321, programId: "p", objectiveId: "o",
      objectiveRevision: 2, questionId: "q-1", focusSessionId: "focus-1",
      evaluator: "llm-review", assisted: true,
      assistance: { highestHintLevel: 1, independent: false },
      taskKind: "guided-practice",
      rubricResults: [{ criterion: "Explain isolation", criterionId: "c1",
        met: true, evidence: "Used an MVCC example" }],
    }],
  };
  assert.deepEqual(decodeLearningState(original), original);
});

test("malformed v3 metadata is rejected rather than trusted", () => {
  const base = { version: 3, target: null, gaps: [], evidence: [{
    id: "e1", type: "practice", scope: "learner", concept: "C",
    source: "src", createdAt: 10,
  }] };
  assert.throws(() => decodeLearningState({ ...base,
    evidence: [{ ...base.evidence[0], evaluator: "provider-selected" }] }), /unsupported shape/);
  assert.throws(() => decodeLearningState({ ...base,
    evidence: [{ ...base.evidence[0], assistance:
      { highestHintLevel: 1, independent: true } }] }), /unsupported shape/);
  assert.throws(() => decodeLearningState({ ...base,
    evidence: [{ ...base.evidence[0], rubricResults: [{
      criterion: "C", criterionId: 123, met: true, evidence: "x",
    }] }] }), /unsupported shape/);
});
 
test("v2 files cannot smuggle malformed v3 provenance into a promoted state", () => {
  assert.throws(() => decodeLearningState({
    version: 2, target: null, gaps: [], evidence: [{
      id: "historical", type: "practice", scope: "learner",
      source: "note", concept: "C", createdAt: 100,
      assistance: { highestHintLevel: 4, independent: true },
    }],
  }), /unsupported shape/);
});
