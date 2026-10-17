import assert from "node:assert/strict";
import test from "node:test";
import {
  recordPracticeEvaluation,
  recordReviewFindings,
} from "../../../src/domain/learning-state/transitions";
import { LearningState } from "../../../src/domain/learning-state/types";

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

test("review evidence is idempotent per logical review and preserves separate reviews", () => {
  const finding = {
    kind: "missing-relation" as const, concept: "SQL",
    title: "Isolation", detail: "Explain concurrent visibility",
  };
  const initial = { version: 2 as const, target: null, gaps: [], evidence: [] };
  const first = recordReviewFindings(initial, {
    reviewId: "review:s:t1", findings: [finding], source: "notes.md",
  }, { now: () => 123, uuid: () => "random" });
  const duplicate = recordReviewFindings(first, {
    reviewId: "review:s:t1", findings: [finding], source: "notes.md",
  });
  assert.equal(duplicate.evidence.length, 1);
  assert.equal(duplicate.evidence[0]?.id, "review:s:t1:0");
  const second = recordReviewFindings(duplicate, {
    reviewId: "review:s:t2", findings: [finding], source: "notes.md",
  });
  assert.equal(second.evidence.length, 2);
});

test("misconception resolution needs repeated unassisted criterion-complete evidence", () => {
  const submit = (state: LearningState, at: number, outcome: "partial" | "correct",
    assisted: boolean, misconception: string[],
    taskKind: "guided-practice" | "recall" = "guided-practice") => recordPracticeEvaluation(state, {
    source: "notes.md", programId: "p", objectiveId: "o", assisted,
    evaluation: {
      kind: "evaluation", concept: "Replication", outcome,
      feedback: "Verified criterion", misconceptions: misconception, taskKind,
      rubricResults: [{ criterion: "Explain conflicts", met: outcome === "correct",
        evidence: "Answer reasoning" }],
    },
  }, { now: () => at, uuid: () => "evt-" + at });
  const initial = submit(baseState(), 100, "partial", false, ["Missed conflict"]);
  assert.equal(initial.gaps[0].status, "open");
  const assisted = submit(initial, 200, "correct", true, []);
  assert.equal(assisted.gaps[0].status, "improving");
  const one = submit(assisted, 300, "correct", false, []);
  assert.equal(one.gaps[0].status, "improving");
  const two = submit(one, 300 + 12 * 3_600_000, "correct", false, [], "recall");
  assert.equal(two.gaps[0].status, "resolved");
  const reopened = submit(two, 300 + 24 * 3_600_000, "partial", false, ["Missed conflict"]);
  assert.equal(reopened.gaps[0].status, "open");
});

test("historical mastery cannot resolve a newly reopened misconception", () => {
  const practice = (state: LearningState, at: number,
    outcome: "incorrect" | "correct", kind: "guided-practice" | "recall") =>
    recordPracticeEvaluation(state, {
      programId: "p", objectiveId: "o", source: "lesson.md",
      evaluation: {
        kind: "evaluation", concept: "Isolation", outcome, taskKind: kind,
        feedback: "Evidence checked",
        misconceptions: outcome === "correct" ? [] : ["Missed lock ordering"],
        rubricResults: [{ criterion: "Explain lock ordering", met: outcome === "correct",
          evidence: "Attempt verified" }],
      },
    }, { now: () => at, uuid: () => "e-" + at });
  const a = practice(baseState(), 100, "correct", "guided-practice");
  const b = practice(a, 100 + 12 * 3_600_000, "correct", "recall");
  const c = practice(b, 100 + 24 * 3_600_000, "incorrect", "guided-practice");
  assert.equal(c.gaps[0]?.status, "open");
  const d = practice(c, 100 + 25 * 3_600_000, "correct", "guided-practice");
  assert.equal(d.gaps[0]?.status, "improving");
  const e = practice(d, 100 + 26 * 3_600_000, "correct", "guided-practice");
  assert.equal(e.gaps[0]?.status, "improving");
  const f = practice(e, 100 + 38 * 3_600_000, "correct", "recall");
  assert.equal(f.gaps[0]?.status, "resolved");
});


test("stable criterion identity closes a reworded gap only after independent delayed recall", () => {
  const submit = (state: LearningState, at: number,
    outcome: "partial" | "correct", criterion: string,
    kind: "guided-practice" | "recall" = "guided-practice") =>
    recordPracticeEvaluation(state, {
      source: "lesson.md", programId: "p", objectiveId: "foundation",
      evaluation: {
        kind: "evaluation", concept: "Concurrency", outcome, taskKind: kind,
        objectiveRevision: 1, feedback: "Rubric evidence",
        misconceptions: outcome === "partial" ? ["Missing guarantee"] : [],
        rubricResults: [{ criterion, criterionId: "c1", met: outcome === "correct",
          evidence: "Independently tested" }],
      },
    }, { now: () => at, uuid: () => "event-" + at });
  const failed = submit(baseState(), 100, "partial", "Old criterion");
  assert.equal(failed.gaps[0].status, "open");
  const corrected = submit(failed, 200, "correct", "Reworded criterion");
  assert.equal(corrected.gaps[0].status, "improving");
  const recalled = submit(corrected, 200 + 12 * 3_600_000,
    "correct", "Reworded criterion", "recall");
  assert.equal(recalled.gaps[0].status, "resolved");
});
