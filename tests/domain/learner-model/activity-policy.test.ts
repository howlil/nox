import assert from "node:assert/strict";
import test from "node:test";
import { selectAdaptiveActivity } from "../../../src/domain/learner-model/activity-policy";
import { startObjectiveFocus, transitionObjectiveFocus } from "../../../src/domain/learning-program/focus-transitions";
import { chooseNextActivity } from "../../../src/domain/learning-program/rules";
import type { LearningProgram, LearningObjective } from "../../../src/domain/learning-program/types";
import type { LearningEvidence, LearningState } from "../../../src/domain/learning-state/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 18, 6, 0);
function objective(id: string, prereqs: string[] = [], priority: LearningObjective["priority"] = "core"): LearningObjective {
  return { id, title: id, outcome: "Explain " + id, prerequisiteIds: prereqs,
    estimatedMinutes: 40, rubric: ["Explain " + id], sourceRefs: [], priority,
    objectiveRevision: 1 };
}
function program(overrides: Partial<LearningProgram> = {}): LearningProgram {
  return {
    version: 2, id: "learn", goal: "Systems engineering", createdAt: 0,
    planVersion: 1,
    constraints: { minutesPerSession: 45, sessionsPerWeek: 3, sourceBound: false,
      sourcePaths: [], excludedTopics: [] },
    objectives: [objective("basics"), objective("advanced", ["basics"])],
    ...overrides,
  };
}
function evidence(objectiveId: string, id: string, time: number,
  options: { result?: "correct" | "incorrect"; hint?: 0 | 1 | 2 | 3 | 4;
    task?: "recall" | "guided-practice" | "transfer" | "diagnostic";
    revision?: number; criterionMet?: boolean; scope?: "learner" | "material";
    programId?: string; coverage?: "single-item" } = {}): LearningEvidence {
  const revision = options.revision ?? 1;
  const result = options.result ?? "correct";
  const hint = options.hint ?? 0;
  return {
    id, type: "practice", scope: options.scope ?? "learner",
    concept: objectiveId, source: "note.md", createdAt: time,
    programId: options.programId ?? "learn", objectiveId,
    outcome: result, evidenceVersion: 3,
    questionId: "q-" + id, objectiveRevision: revision,
    evaluator: "llm-review", assisted: hint > 0,
    assistance: { highestHintLevel: hint, independent: hint === 0 },
    taskKind: options.task ?? "guided-practice",
    ...(options.coverage ? { assessmentCoverage: options.coverage } : {}),
    rubricResults: [{ criterionId: objectiveId + "@" + revision + ":criterion-1",
      criterion: "Explain " + objectiveId, met: options.criterionMet ?? result === "correct",
      evidence: "checked" }],
  };
}
function state(...attempts: LearningEvidence[]): LearningState {
  return { version: 3, target: null, gaps: [], evidence: attempts };
}
const mastered = (id: string) => [
  evidence(id, id + "-first", NOW - 15 * HOUR),
  evidence(id, id + "-recall", NOW - HOUR, { task: "recall" }),
];

test("unknown evidence starts a diagnostic on the first eligible core objective", () => {
  const p = program();
  const result = selectAdaptiveActivity(p, state(), NOW);
  assert.equal(result.kind, "diagnostic");
  assert.equal(result.objective?.id, "basics");
  assert.equal(result.provenance?.trigger, "assessment-needed");
  assert.deepEqual(result.provenance?.evidenceIds, []);
});

test("unmet prerequisites block progression, independent delayed recall unlocks it", () => {
  const p = program();
  const justCorrect = evidence("basics", "early", NOW - 2 * HOUR);
  const before = selectAdaptiveActivity(p, state(justCorrect), NOW);
  assert.equal(before.kind, "wait");
  assert.equal(before.provenance?.trigger, "recall-pending");
  const due = selectAdaptiveActivity(p, state(justCorrect), NOW + 12 * HOUR);
  assert.equal(due.kind, "recall");
  assert.equal(due.objective?.id, "basics");
  const after = selectAdaptiveActivity(p, state(...mastered("basics")), NOW);
  assert.equal(after.objective?.id, "advanced");
  assert.equal(after.kind, "diagnostic");
});

test("assisted and MCQ formative success must be independently verified", () => {
  for (const option of [{ hint: 2 as const }, { coverage: "single-item" as const }]) {
    const attempt = evidence("basics", "assisted", NOW - HOUR, option);
    const result = selectAdaptiveActivity(program(), state(attempt), NOW);
    assert.equal(result.kind, "guided-practice");
    assert.equal(result.objective?.id, "basics");
    assert.equal(result.provenance?.trigger, "verify-independently");
  }
});

test("failure is criterion-specific and repeated errors select guided scaffolding", () => {
  const failed = (id: string, time: number) =>
    evidence("basics", id, time, { result: "incorrect" });
  const one = failed("first", NOW - 3 * HOUR);
  const initial = selectAdaptiveActivity(program(), state(one), NOW);
  assert.equal(initial.kind, "teach");
  assert.deepEqual(initial.provenance?.criterionIds, ["basics@1:criterion-1"]);
  assert.deepEqual(initial.provenance?.evidenceIds, ["first"]);
  const repeated = selectAdaptiveActivity(program(),
    state(one, failed("second", NOW - 2 * HOUR), failed("third", NOW - HOUR)), NOW);
  assert.equal(repeated.kind, "guided-practice");
  assert.equal(repeated.provenance?.trigger, "scaffold");
  assert.equal(repeated.provenance?.scaffoldLevel, 3);
});

test("failed delayed retrieval reopens remediation instead of preserving previous mastery", () => {
  const rows = mastered("basics");
  const failedRecall = evidence("basics", "regress", NOW, {
    result: "incorrect", task: "recall",
  });
  const result = selectAdaptiveActivity(program(), state(...rows, failedRecall), NOW + 1);
  assert.equal(result.kind, "teach");
  assert.equal(result.objective?.id, "basics");
  assert.equal(result.provenance?.trigger, "criterion-failed");
});

test("required transfer follows independent recall, and completed transfer unlocks next objective", () => {
  const p = program({ objectives: [
    { ...objective("basics"), requiresTransfer: true }, objective("advanced", ["basics"]),
  ] });
  const rows = mastered("basics");
  const transfer = selectAdaptiveActivity(p, state(...rows), NOW);
  assert.equal(transfer.kind, "transfer");
  assert.equal(transfer.objective?.id, "basics");
  const performed = evidence("basics", "transfer", NOW, { task: "transfer" });
  const next = selectAdaptiveActivity(p, state(...rows, performed), NOW + 1);
  assert.equal(next.kind, "diagnostic");
  assert.equal(next.objective?.id, "advanced");
});

test("earliest eligible recall wins over a different remediation candidate", () => {
  const p = program({ objectives: [objective("x"), objective("y")] });
  const due = evidence("y", "y-early", NOW - 16 * HOUR);
  const failure = evidence("x", "x-fail", NOW - HOUR, { result: "incorrect" });
  const result = selectAdaptiveActivity(p, state(due, failure), NOW);
  assert.equal(result.kind, "recall");
  assert.equal(result.objective?.id, "y");
});

test("core precedes supporting and optional, stable objective order breaks ties", () => {
  const p = program({ objectives: [
    objective("optional", [], "optional"),
    objective("support", [], "supporting"),
    objective("core", [], "core"),
  ] });
  assert.equal(selectAdaptiveActivity(p, state(), NOW).objective?.id, "core");
});

test("focus always wins over priority, deadline and elapsed timer", () => {
  const p = program({ constraints: {
    ...program().constraints, deadline: "2020-01-01",
  }, objectives: [objective("core"), objective("pinned", [], "optional")],
    session: { startedAt: NOW - 60 * 60_000, timeBudgetMinutes: 45,
      timing: { version: 2, checkpointAt: NOW,
        activeMs: 45 * 60_000, aiWaitingMs: 0, pauseReasons: [] } },
  });
  const focused = startObjectiveFocus(p, "pinned", "chat-1", 10, "focus-1");
  const selected = selectAdaptiveActivity(focused, state(), NOW);
  assert.equal(selected.kind, "diagnostic");
  assert.equal(selected.objective?.id, "pinned");
  assert.equal(selected.minutesRemaining, undefined);
  assert.equal(selectAdaptiveActivity(transitionObjectiveFocus(focused, "pause", NOW), state(), NOW).kind, "wait");
  assert.equal(selectAdaptiveActivity({ ...focused, planVersion: 2 }, state(), NOW).provenance?.trigger, "focus-invalid");
});

test("old rubric, other program and material evidence never establish mastery", () => {
  const p = program({ planVersion: 2, objectives: [objective("basics"), objective("advanced", ["basics"])]
    .map(o => ({ ...o, objectiveRevision: 2 })) });
  const stale = evidence("basics", "stale", NOW - HOUR, { revision: 1 });
  const other = evidence("basics", "other", NOW - HOUR, { revision: 2, programId: "elsewhere" });
  const material = evidence("basics", "material", NOW - HOUR, { revision: 2, scope: "material" });
  const selected = selectAdaptiveActivity(p, state(stale, other, material), NOW);
  assert.equal(selected.kind, "diagnostic");
  assert.equal(selected.objective?.id, "basics");
});

test("legacy v1 activity selection is preserved when no versioned evidence exists", () => {
  const old = program({
    version: 1, objectives: [objective("basics"), objective("advanced", ["basics"])]
      .map(({ objectiveRevision: _unused, ...o }) => o),
  });
  const prior: LearningEvidence = {
    id: "old", type: "practice", scope: "learner", concept: "basics", source: "notes",
    programId: "learn", objectiveId: "basics", createdAt: NOW - HOUR, outcome: "incorrect",
  };
  const expected = chooseNextActivity(old, [prior], NOW);
  const actual = selectAdaptiveActivity(old, state(prior), NOW);
  assert.equal(actual.kind, expected.kind);
  assert.equal(actual.objective?.id, expected.objective?.id);
  assert.equal(actual.provenance?.trigger, "legacy-compat");
});

test("session pause and exhaustion keep legacy timer invariants", () => {
  const timed = program({ session: { startedAt: NOW - HOUR, timeBudgetMinutes: 45,
    timing: { version: 2, checkpointAt: NOW, activeMs: 45 * 60_000,
      aiWaitingMs: 0, pauseReasons: [] } },
  });
  assert.equal(selectAdaptiveActivity(timed, state(), NOW).kind, "timebox-ended");
  const paused = program({ session: { startedAt: NOW - HOUR, timeBudgetMinutes: 45,
    timing: { version: 2, checkpointAt: NOW, activeMs: 10 * 60_000,
      aiWaitingMs: 0, pauseReasons: ["manual"] } },
  });
  assert.equal(selectAdaptiveActivity(paused, state(), NOW).provenance?.trigger, "session-paused");
});

test("policy is pure and deterministic for the same program evidence and timestamp", () => {
  const p = program(), s = state(evidence("basics", "a", NOW - HOUR,
    { result: "incorrect" }));
  const oldP = structuredClone(p), oldS = structuredClone(s);
  const first = selectAdaptiveActivity(p, s, NOW);
  const second = selectAdaptiveActivity(p, s, NOW);
  assert.deepEqual(first, second);
  assert.deepEqual(p, oldP);
  assert.deepEqual(s, oldS);
});
