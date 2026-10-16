import assert from "node:assert/strict";
import test from "node:test";
import type { LearningEvidence } from "../../../src/domain/learning-state/types";
import type { LearningProgram } from "../../../src/domain/learning-program/types";
import { deriveObjectiveReadiness } from "../../../src/domain/learning-program/objective-readiness";
import { decideFocusedLearningActivity, decideLearningActivity,
  selectEligibleObjective, nextEligibleRecallAt } from "../../../src/domain/learning-program/activity-policy";
import { chooseNextActivity } from "../../../src/domain/learning-program/rules";

const now = Date.UTC(2026, 9, 17, 12);
const DAY = 86_400_000;
const program = (): LearningProgram => ({
  version: 1, id: "p", goal: "Build reliable systems", planVersion: 1, createdAt: 100,
  constraints: { minutesPerSession: 45, sessionsPerWeek: 3,
    sourcePaths: [], sourceBound: false, excludedTopics: [] },
  objectives: [
    { id: "foundation", title: "Foundation", outcome: "Explain locks",
      rubric: ["Explain locking"], criteria: [{ id: "c1", description: "Explain locking", required: true }],
      prerequisiteIds: [], estimatedMinutes: 30, sourceRefs: [], priority: "core" },
    { id: "advanced", title: "Advanced", outcome: "Apply isolation",
      rubric: ["Explain isolation"], criteria: [{ id: "c2", description: "Explain isolation", required: true }],
      prerequisiteIds: ["foundation"], estimatedMinutes: 45, sourceRefs: [], priority: "core" },
    { id: "optional", title: "Optional", outcome: "Explore observability",
      rubric: ["Explain tracing"], criteria: [{ id: "c3", description: "Explain tracing", required: true }],
      prerequisiteIds: [], estimatedMinutes: 30, sourceRefs: [], priority: "optional" },
  ],
});
function attempt(objectiveId: string, id: string, when: number,
  outcome: "correct" | "incorrect" | "partial", taskKind: LearningEvidence["taskKind"] = "guided-practice",
  assisted = false): LearningEvidence {
  const criterionId = objectiveId === "foundation" ? "c1" : objectiveId === "advanced" ? "c2" : "c3";
  const criterion = objectiveId === "foundation" ? "Explain locking" :
    objectiveId === "advanced" ? "Explain isolation" : "Explain tracing";
  return {
    id, programId: "p", objectiveId, type: "practice", scope: "learner",
    concept: "systems", source: "lesson.md", createdAt: when, questionId: id,
    evaluator: "llm-review", objectiveRevision: 1, outcome, taskKind, assisted,
    assistance: { highestHintLevel: assisted ? 1 : 0, independent: !assisted },
    rubricResults: [{ criterion, criterionId, met: outcome === "correct",
      evidence: "Observed " + outcome }],
  };
}
const mastered = () => [
  attempt("foundation", "work", now - 4 * DAY, "correct"),
  attempt("foundation", "recall", now - 3 * DAY, "correct", "recall"),
];

test("readiness reports blocked prerequisites and stable failed criterion IDs", () => {
  const blocked = deriveObjectiveReadiness(program(), "advanced", [
    attempt("advanced", "wrong", now - 100, "incorrect"),
  ], now);
  assert.equal(blocked.prerequisiteStatus, "blocked");
  assert.deepEqual(blocked.blockedBy, ["foundation"]);
  assert.deepEqual(blocked.failedCriterionIds, ["c2"]);
  assert.deepEqual(blocked.failedEvidenceIds, ["wrong"]);
  assert.equal(selectEligibleObjective(program(), [], now)?.objective.id, "foundation");
  assert.equal(chooseNextActivity(program(), [], now).kind, "diagnostic");
});

test("due recall is selected deterministically ahead of new topics, but not repeated after success", () => {
  const p = program();
  const previouslyMastered = mastered();
  const first = selectEligibleObjective(p, previouslyMastered, now)!;
  assert.equal(first.objective.id, "foundation");
  assert.equal(first.progress.status, "mastered");
  assert.equal(decideLearningActivity(p, first, previouslyMastered, now).kind, "recall");
  const newRecall = attempt("foundation", "retrieved", now, "correct", "recall");
  const second = selectEligibleObjective(p, [...previouslyMastered, newRecall], now)!;
  assert.equal(second.objective.id, "foundation");
  assert.equal(decideLearningActivity(p, second, [...previouslyMastered, newRecall], now).kind, "transfer");
  const transferred = attempt("foundation", "transfer", now + 1, "correct", "transfer");
  const next = selectEligibleObjective(p, [...previouslyMastered, newRecall, transferred], now + 1)!;
  assert.equal(next.objective.id, "advanced");
  assert.equal(decideLearningActivity(p, next,
    [...previouslyMastered, newRecall, transferred], now + 1).kind, "diagnostic");
});

test("focus lock suppresses timebox, optional objectives and an unrelated overdue topic", () => {
  const p = program();
  p.focus = { id: "focused", programId: "p", objectiveId: "advanced",
    curriculumRevision: 1, status: "active", startedAt: now };
  p.session = { startedAt: now - 3 * DAY, timeBudgetMinutes: 45 };
  const selected = selectEligibleObjective(p, mastered(), now);
  assert.equal(selected?.objective.id, "advanced");
  assert.equal(decideFocusedLearningActivity(p, mastered(), now).objective?.id, "advanced");
  assert.equal(chooseNextActivity(p, mastered(), now).kind, "diagnostic");
  p.focus.status = "paused";
  assert.equal(decideFocusedLearningActivity(p, mastered(), now).kind, "wait");
  p.focus.curriculumRevision = 2;
  p.focus.status = "active";
  assert.throws(() => decideFocusedLearningActivity(p, mastered(), now), /stale/);
});

test("criterion failures repair first, scaffold once, then independently retry; no repeated lecture", () => {
  const p = program();
  const initial = mastered();
  const first = attempt("advanced", "bad-one", now - 400, "incorrect");
  const second = attempt("advanced", "bad-two", now - 300, "partial");
  const one = decideLearningActivity(p, deriveObjectiveReadiness(p, "advanced", [...initial, first], now),
    [...initial, first], now);
  assert.equal(one.kind, "remediate");
  assert.deepEqual(one.targetCriterionIds, ["c2"]);
  const attempts = [...initial, first, second];
  const two = decideLearningActivity(p, deriveObjectiveReadiness(p, "advanced", attempts, now), attempts, now);
  assert.equal(two.kind, "teach");
  assert.equal(two.scaffoldLevel, 2);
  assert.deepEqual(two.sourceEvidenceIds, ["bad-one", "bad-two"]);
  p.instructionEvents = [{ objectiveId: "advanced", afterEvidenceAt: second.createdAt,
    taughtAt: now - 200 }];
  const afterInstruction = decideLearningActivity(p,
    deriveObjectiveReadiness(p, "advanced", attempts, now), attempts, now);
  assert.equal(afterInstruction.kind, "guided-practice");
  assert.deepEqual(afterInstruction.targetCriterionIds, ["c2"]);
  const newFailure = attempt("advanced", "bad-three", now - 100, "incorrect");
  const three = decideLearningActivity(p, deriveObjectiveReadiness(p, "advanced",
    [...attempts, newFailure], now), [...attempts, newFailure], now);
  assert.equal(three.kind, "teach");
  assert.equal(three.scaffoldLevel, 3);
});

test("thresholds cannot weaken mastery or overrun bounded scaffolding", () => {
  const p = program();
  const evidence = [...mastered(), attempt("advanced", "bad-one", now - 300, "incorrect"),
    attempt("advanced", "bad-two", now - 200, "incorrect")];
  const readiness = deriveObjectiveReadiness(p, "advanced", evidence, now);
  assert.equal(decideLearningActivity(p, readiness, evidence, now,
    { scaffoldAfterFailures: 3 }).kind, "remediate");
  assert.equal(decideLearningActivity(p, readiness, evidence, now,
    { scaffoldAfterFailures: 2 }).kind, "teach");
  assert.throws(() => decideLearningActivity(p, readiness, evidence,
    now, { scaffoldAfterFailures: 1 }), /Invalid/);
  assert.throws(() => selectEligibleObjective(p, evidence,
    now, { recallDueGraceMinutes: -1 }), /Invalid/);
});

test("next recall is scheduled and stable across repeated no-evidence decisions", () => {
  const p = program();
  const first = attempt("foundation", "work", now - 24 * 60 * 60 * 1000, "correct");
  const evidence = [first];
  const earliest = first.createdAt + DAY;
  assert.equal(nextEligibleRecallAt(p, evidence, now - 100), earliest);
  assert.deepEqual(chooseNextActivity(p, evidence, now), chooseNextActivity(p, evidence, now));
  const retired = program();
  retired.objectives[0].deprecated = true;
  retired.objectives[1].prerequisiteIds = [];
  assert.equal(selectEligibleObjective(retired, [], now)?.objective.id, "advanced");
});
