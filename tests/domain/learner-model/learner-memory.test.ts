import assert from "node:assert/strict";
import test from "node:test";
import { projectLearnerModel, selectRelevantLearnerState } from "../../../src/domain/learner-model/learner-memory";
import type { LearningProgram } from "../../../src/domain/learning-program/types";
import type { LearningEvidence, KnowledgeGap } from "../../../src/domain/learning-state/types";

const at = Date.UTC(2026, 9, 17, 12);
const program = (id = "one", revision = 1): LearningProgram => ({
  version: 1, id, goal: "Learn systems", createdAt: 1, planVersion: revision,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourcePaths: [], sourceBound: false, excludedTopics: [] },
  objectives: [
    { id: "foundation", title: "Basics", outcome: "Explain locks",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain locks"],
      criteria: [{ id: "c1", description: "Explain locks", required: true }],
      sourceRefs: [], priority: "core" },
    { id: "transactions", title: "Transactions", outcome: "Explain isolation",
      prerequisiteIds: ["foundation"], estimatedMinutes: 40, rubric: ["Explain isolation"],
      criteria: [{ id: "c2", description: "Explain isolation", required: true }],
      sourceRefs: [], priority: "core" },
    { id: "network", title: "Networking", outcome: "Explain routing",
      prerequisiteIds: [], estimatedMinutes: 30, rubric: ["Explain routing"],
      criteria: [{ id: "c3", description: "Explain routing", required: true }],
      sourceRefs: [], priority: "optional" },
  ],
});
function evidence(id: string, objectiveId: string, atTime: number, outcome = "correct",
  assisted = false, programId = "one"): LearningEvidence {
  const criterionId = objectiveId === "transactions" ? "c2" :
    objectiveId === "foundation" ? "c1" : "c3";
  const criterion = objectiveId === "transactions" ? "Explain isolation" :
    objectiveId === "foundation" ? "Explain locks" : "Explain routing";
  return {
    id, scope: "learner", type: "practice", programId, objectiveId,
    concept: criterion, source: "learning-session", outcome, createdAt: atTime,
    taskKind: "guided-practice", objectiveRevision: 1,
    evaluator: "llm-review", assisted,
    rubricResults: [{ criterionId, criterion, met: outcome === "correct",
      evidence: "Evaluation at " + id }],
  };
}

test("projection is deterministic, reconstructible, scoped, and updates its fingerprint", () => {
  const entries = [evidence("b", "transactions", at - 100, "incorrect"),
    evidence("a", "transactions", at - 150),
    evidence("f", "foundation", at - 300),
    evidence("foreign", "transactions", at - 80, "incorrect", false, "two")];
  const gaps: KnowledgeGap[] = [{ id: "gap-1", concept: "Isolation",
    reason: "Failed to explain isolation", evidenceIds: ["b"],
    programId: "one", objectiveId: "transactions", status: "open" }];
  const first = projectLearnerModel(program(), entries, gaps, at);
  const reordered = projectLearnerModel(program(), [...entries].reverse(), gaps, at);
  assert.deepEqual(first, reordered);
  assert.equal(first.objectives.transactions.attempts, 2);
  assert.equal(first.objectives.transactions.criteria[0].status, "needs-repair");
  assert.deepEqual(first.objectives.transactions.criteria[0].unresolvedGapIds, ["gap-1"]);
  assert.equal(first.objectives.foundation.lastIndependentAttemptAt, at - 300);
  assert.equal(first.objectives.network.recallReadiness, "unseen");
  assert.equal(projectLearnerModel(program("two"), entries, [], at).objectives.transactions.attempts, 1);
  assert.notEqual(first.evidenceRevision, projectLearnerModel(program(), [
    ...entries, evidence("new", "transactions", at),
  ], gaps, at).evidenceRevision);
  assert.notEqual(first.evidenceRevision, projectLearnerModel(program("one", 2),
    entries, gaps, at).evidenceRevision);
  assert.notEqual(first.evidenceRevision, projectLearnerModel(program(), entries,
    [{ ...gaps[0], status: "resolved" }], at).evidenceRevision);
});

test("delayed independent recall creates dueAt but assistance cannot masquerade as mastery", () => {
  const first = evidence("first", "transactions", at - 3 * 86_400_000);
  const delayed = {
    ...evidence("later", "transactions", at - 2 * 86_400_000),
    taskKind: "recall" as const,
  };
  const model = projectLearnerModel(program(), [first, delayed], [], at);
  assert.equal(model.objectives.transactions.recallReadiness, "scheduled");
  assert.equal(model.objectives.transactions.nextRecallAt,
    delayed.createdAt + 3 * 86_400_000);
  assert.equal(projectLearnerModel(program(), [first, delayed], [],
    at + 2 * 86_400_000).objectives.transactions.recallReadiness, "due");
  const assisted = { ...delayed, assisted: true,
    assistance: { highestHintLevel: 2 as const, independent: false } };
  assert.equal(projectLearnerModel(program(), [first, assisted], [],
    at).objectives.transactions.recallReadiness, "needs-repair");
});

test("reworded criterion identity survives revision while legacy mismatches are ignored", () => {
  const revised = program("one", 2);
  revised.objectives[1].rubric = ["Describe isolation precisely"];
  revised.objectives[1].criteria![0].description = "Describe isolation precisely";
  const current = evidence("stable", "transactions", at);
  const old = { ...current, id: "legacy", objectiveRevision: undefined,
    rubricResults: [{ criterion: "Explain isolation", met: false, evidence: "Legacy" }] };
  const projected = projectLearnerModel(revised, [current, old], [], at);
  assert.equal(projected.objectives.transactions.criteria[0].status, "demonstrated");
  assert.deepEqual(projected.objectives.transactions.criteria[0].evidenceIds, ["stable"]);
  revised.objectives[1].criteria![0].id = "meaning-changed";
  assert.equal(projectLearnerModel(revised, [current], [], at)
    .objectives.transactions.criteria[0].status, "unseen");
});

test("relevant snapshot only includes current objective, required prerequisites, and bounded episodes", () => {
  const entries = [
    evidence("foundation", "foundation", at - 1000),
    evidence("failed", "transactions", at - 900, "incorrect"),
    evidence("independent", "transactions", at - 800),
    evidence("recent", "transactions", at - 700, "incorrect"),
    evidence("unrelated", "network", at - 600),
    evidence("foreign", "transactions", at - 500, "incorrect", false, "two"),
  ];
  const gaps: KnowledgeGap[] = [
    { id: "gap-matching", concept: "Isolation", reason: "Missed isolation rule",
      evidenceIds: ["recent"], programId: "one", objectiveId: "transactions", status: "open" },
    { id: "gap-other", concept: "Routing", reason: "Should not leak",
      evidenceIds: ["unrelated"], programId: "one", objectiveId: "network", status: "open" },
  ];
  const current = program();
  const projected = projectLearnerModel(current, entries, gaps, at);
  const picked = selectRelevantLearnerState(current, projected, entries,
    gaps, "transactions", { maxEpisodes: 5 });
  assert.deepEqual(picked.episodes.map(e => e.evidenceId),
    ["recent", "failed", "independent", "foundation"]);
  assert.deepEqual(picked.prerequisites.map(item => item.objectiveId), ["foundation"]);
  assert.deepEqual(picked.gaps.map(item => item.gapId), ["gap-matching"]);
  assert.ok(JSON.stringify(picked).length < 3500);
  assert.equal(JSON.stringify(picked).includes("Should not leak"), false);
  assert.equal(JSON.stringify(picked).includes("foreign"), false);
  assert.equal(JSON.stringify(picked).includes("unrelated"), false);
  assert.throws(() => selectRelevantLearnerState(current, projected, entries,
    gaps, "unknown", { maxEpisodes: 2 }), /Unknown or deprecated/);
  assert.deepEqual(selectRelevantLearnerState(current, projected, entries,
    gaps, "transactions", { maxGaps: 0 }).gaps, []);
});


test("memory retrieval rejects stale evidence fingerprints and retired objectives", () => {
  const current = program();
  const original = [evidence("old", "transactions", at - 100, "incorrect")];
  const model = projectLearnerModel(current, original, [], at);
  const newlyCommitted = [...original, evidence("new", "transactions", at)];
  assert.throws(() => selectRelevantLearnerState(current, model, newlyCommitted,
    [], "transactions"), /stale/);
  const updated = projectLearnerModel(current, newlyCommitted, [], at);
  assert.equal(selectRelevantLearnerState(current, updated, newlyCommitted, [],
    "transactions").episodes[0].evidenceId, "old");
  const retired = structuredClone(current);
  retired.objectives[1].deprecated = true;
  const retiredModel = projectLearnerModel(retired, newlyCommitted, [], at);
  assert.throws(() => selectRelevantLearnerState(retired, retiredModel, newlyCommitted,
    [], "transactions"), /deprecated/);
});

test("revisioned evidence from a future curriculum cannot demonstrate a criterion", () => {
  const current = program("one", 2);
  const impossible = { ...evidence("future", "transactions", at),
    objectiveRevision: 3 };
  assert.equal(projectLearnerModel(current, [impossible], [], at)
    .objectives.transactions.criteria[0].status, "unseen");
});
